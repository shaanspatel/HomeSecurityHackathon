import boto3
import base64
import json
from datetime import datetime
from zoneinfo import ZoneInfo
from decimal import Decimal
from vapi import Vapi
from nova import Nova
from credentials import (
    VAPI_API_KEY, 
    VAPI_PHONE_NUMBER_ID, 
    DEFAULT_CRITICAL_PHONE_NUMBER,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    DYNAMODB_REGION,
    DYNAMODB_METADATA_TABLE,
    DYNAMODB_LOGS_TABLE,
    S3_BUCKET_NAME,
    S3_REGION
)

class master:
    """
    Streams are model-driven. Provide optional 'context' (environment); no hardcoded cases.
    Uses DynamoDB + S3 (videos stored in S3, metadata/logs in DynamoDB).
    """
    def __init__(self, vapi_key, phone_no_id):
        self.phone_no_id = phone_no_id
        self.vapi_client = Vapi(token=vapi_key)
        
        # DynamoDB client
        self.dynamodb = boto3.resource(
            'dynamodb',
            region_name=DYNAMODB_REGION,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY
        )
        self.metadata_table = self.dynamodb.Table(DYNAMODB_METADATA_TABLE)
        self.logs_table = self.dynamodb.Table(DYNAMODB_LOGS_TABLE)
        
        # S3 client
        self.s3_client = boto3.client(
            's3',
            region_name=S3_REGION,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY
        )
        self.s3_bucket = S3_BUCKET_NAME
        
        self.ids = {}
        self.nova_client = Nova()

    def create_stream(self, id: str, context: str | None = None, critical_phone_number: str | None = None):
        if id in self.ids:
            return {"Error": "Stream ID already exists"}
        
        self.ids[id] = {
            "context": context,
            "critical_phone_number": critical_phone_number or DEFAULT_CRITICAL_PHONE_NUMBER
        }
        
        # Store in DynamoDB
        self.metadata_table.put_item(
            Item={
                "id": id,
                "context": context or "",
                "critical_phone_number": self.ids[id]["critical_phone_number"]
            }
        )
        print(f"[STREAM CREATED] {id}")

    def get_stream(self, id):
        # Get metadata
        meta_response = self.metadata_table.get_item(Key={"id": id})
        metadata = meta_response.get("Item", {})
        
        # Query all logs for this stream
        try:
            logs_response = self.logs_table.query(
                KeyConditionExpression='stream_id = :sid',
                ExpressionAttributeValues={':sid': id}
            )
            logs = logs_response.get("Items", [])
        except Exception as e:
            print(f"[WARNING] Could not query logs: {e}")
            logs = []
        
        return {"metadata": metadata, "logs": logs}

    def delete_stream(self, id):
        if id not in self.ids:
            return 1
        
        # Delete metadata
        self.metadata_table.delete_item(Key={"id": id})
        
        # Delete all logs for this stream
        try:
            logs_response = self.logs_table.query(
                KeyConditionExpression='stream_id = :sid',
                ExpressionAttributeValues={':sid': id}
            )
            for log in logs_response.get("Items", []):
                self.logs_table.delete_item(
                    Key={
                        "stream_id": id,
                        "timestamp": log["timestamp"]
                    }
                )
                # Delete S3 video if exists
                if "s3_key" in log:
                    try:
                        self.s3_client.delete_object(Bucket=self.s3_bucket, Key=log["s3_key"])
                    except Exception:
                        pass
        except Exception:
            pass
        
        del self.ids[id]
        print(f"[STREAM DELETED] {id}")
        return 0

    def analyze(self, id, video_bytes: bytes, timestamp: str | None = None):
        try:
            # Use PST timezone
            pst = ZoneInfo("America/Los_Angeles")
            ts = timestamp or datetime.now(pst).isoformat()
            ctx = self.ids[id].get("context")
            
            video_desc = self.nova_client.describe_video(video_bytes, context=ctx)
            result = self.nova_client.classify_threat(video_desc, context=ctx)

            severity = result.get("severity", "normal")
            threat_type = result.get("threat_type", "other")
            summary = result.get("summary", "")
            confidence = result.get("confidence", 0.0)
            suggested_action = result.get("suggested_action", "")

            if severity == "normal":
                print(f"[SAFE] {id} @ {ts}: {summary}")
                return {"status": "safe", **result}

            # Upload video to S3
            s3_key = f"{id}/{ts.replace(':', '-')}.mp4"
            self.s3_client.put_object(
                Bucket=self.s3_bucket,
                Key=s3_key,
                Body=video_bytes
            )
            
            # DynamoDB requires Decimal for floats
            if isinstance(confidence, float):
                confidence = Decimal(str(confidence))
            
            # Store in DynamoDB (with S3 reference instead of video bytes)
            self.logs_table.put_item(
                Item={
                    "stream_id": id,
                    "timestamp": ts,
                    "severity": severity,
                    "threat_type": threat_type,
                    "summary": summary,
                    "confidence": confidence,
                    "suggested_action": suggested_action,
                    "video_description": video_desc,
                    "context": ctx or "",
                    "s3_bucket": self.s3_bucket,
                    "s3_key": s3_key
                }
            )
            print(f"[LOGGED] {id} @ {ts}: {summary}")

            if severity == "critical":
                phone = self.ids[id]["critical_phone_number"]
                if phone:
                    self.vapi_call(phone, ts, summary)
                    print(f"[CALLED] {id} @ {ts}: {summary} (called {phone})")
                    return {"status": "called", **result}
                else:
                    print(f"[CRITICAL-NO-CALL] {id} @ {ts}: {summary}")
                    return {"status": "critical-no-call", **result}

            return {"status": "logged", **result}

        except Exception as e:
            print(f"[ERROR] {id} @ {timestamp or 'auto'}: {e}")
            import traceback
            traceback.print_exc()
            return {"status": "error", "error": str(e)}

    def vapi_call(self, phone_no, timestamp, description):
        # Convert ISO timestamp to human-readable format in PST
        try:
            dt = datetime.fromisoformat(timestamp)
            readable_time = dt.strftime("%B %d, %Y at %I:%M %p PST")
        except:
            readable_time = timestamp
        
        context = f"""
You are an assistant that makes outbound calls to notify users of critical threats detected by an AI security system.
Inform the user that: {description} (detected on {readable_time})."""
        assistant = self.vapi_client.assistants.create(
            name="Jamie",
            model={
                "provider": "openai",
                "model": "gpt-4o",
                "messages": [{"role": "system", "content": context}],
            },
            voice={"provider": "11labs", "voiceId": "cgSgspJ2msm6clMCkdW9"},
            first_message=f"Hi, a critical safety issue was detected on {readable_time}: {description}.",
        )
        self.vapi_client.calls.create(
            assistant_id=assistant.id,
            phone_number_id=self.phone_no_id,
            customer={"number": phone_no},
        )

# Example run
if __name__ == "__main__":
    master_instance = master(VAPI_API_KEY, VAPI_PHONE_NUMBER_ID)
    master_instance.create_stream(
        id="general_watch",
        context="surveillance of a house",  
        critical_phone_number=DEFAULT_CRITICAL_PHONE_NUMBER
    )
    with open('Screen Recording 2025-10-25 at 5.20.57 PM.mp4', 'rb') as f:
        master_instance.analyze(
            id="general_watch",
            video_bytes=f.read(),
        )
    
    # Retrieve logs
    print("\n--- Stored Logs ---")
    stream_data = master_instance.get_stream("general_watch")
    print("Metadata:", stream_data["metadata"])
    print("Logs:", json.dumps(stream_data["logs"], indent=2, default=str))

