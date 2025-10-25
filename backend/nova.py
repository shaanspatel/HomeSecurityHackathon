import base64
import json
import boto3
from typing import Optional, Dict, Any
from credentials import AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY

class Nova:
    def __init__(self):
        self.client = boto3.client(
            "bedrock-runtime",
            region_name="us-east-1",
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY
        )
    
    def describe_video(self, video_bytes: bytes, context: Optional[str] = None) -> str:
        request_body = {
            "schemaVersion": "messages-v1",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"text": "Describe the following video in detail."},
                        {
                            "video": {
                                "format": "mp4",
                                "source": {"bytes": base64.b64encode(video_bytes).decode('utf-8')}
                            }
                        }
                    ]
                }
            ],
            "system": [{"text": f"You are a helpful assistant that accurately describes videos in detail.{(' Context: ' + context) if context else ''}"}],
            "inferenceConfig": {
                "max_new_tokens": 300,
                "top_p": 0.1,
                "temperature": 0.3,
                "top_k": 20
            }
        }
        resp = self.client.invoke_model(
            modelId="us.amazon.nova-lite-v1:0",
            body=json.dumps(request_body)
        )
        body = json.loads(resp["body"].read())
        return body["output"]["message"]["content"][0]["text"]

    def classify_threat(self, video_description: str, context: Optional[str] = None) -> Dict[str, Any]:
        system_prompt = """
You are a security and safety assistant. Given a short description of a video clip and optional environment context,
assess the situation for threats or hazards.

Severity:
- normal: no meaningful risk.
- log: noteworthy but not immediately dangerous (monitor or follow-up).
- critical: immediate danger to people or property requiring urgent response.

Output JSON only:
{
  "severity": "normal" | "log" | "critical",
  "threat_type": "none" | "fire" | "smoke" | "weapon" | "violence" | "medical" | "intrusion" | "vandalism" | "accident" | "hazard" | "other",
  "summary": "brief rationale",
  "confidence": 0.0-1.0,
  "suggested_action": "short recommended next step"
}
If an obvious life-safety hazard is present (e.g., fire/flames, thick smoke, visible weapon, active violence, explosion),
mark severity as "critical" even if context is ambiguous.
""".strip()

        user_text_parts = []
        if context:
            user_text_parts.append(f"Context: {context}")
        user_text_parts.append(f"Video description: {video_description}")
        user_text = "\n".join(user_text_parts)

        resp = self.client.converse(
            modelId="us.amazon.nova-micro-v1:0",
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": user_text}]}]
        )
        text = resp["output"]["message"]["content"][0]["text"]
        try:
            return json.loads(text)
        except Exception:
            # Fallback if model returns non-JSON
            return {
                "severity": "log",
                "threat_type": "other",
                "summary": text[:500],
                "confidence": 0.5,
                "suggested_action": "Review manually."
            }

if __name__ == "__main__":
    with open("fire.mp4", "rb") as f:
        video_bytes = f.read()
    nova = Nova()
    description = nova.describe_video(video_bytes, context="surveillance of a house")
    print("Video Description:", description)
    out = nova.classify_threat(
        video_description=description,
        context="surveillance of a house"
    )
    print("Threat Assessment:", json.dumps(out, indent=2))