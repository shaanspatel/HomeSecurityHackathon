from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
import base64, json
from vapi import Vapi
from nova import Nova

"""
### SETUP INFO ###
1) You need to make sure you have an AWS IAM user with Bedrock permissions set up. Or else this will not work.
2) Open a vapi account and get an API key and phone number ID for making calls, the code handles creating an assistant for you.
3) Make sure you have a MongoDB database set up to store the logs and video metadata. Right now its hooked up to my free tier cluster but you can change the mongo_uri to ur own
"""

class master:
    """
    The only functions you need to worry about are create_stream, get_stream, delete_stream, and analyze.
    """
    def __init__(self, vapi_key, phone_no_id, mongo_uri="mongodb+srv://user:hamster@logs-and-video.guiiytv.mongodb.net/?appName=logs-and-video"):
        self.phone_no_id = phone_no_id
        self.vapi_client = Vapi(token=vapi_key)
        self.client = MongoClient(mongo_uri, server_api=ServerApi('1'))
        self.ids = {}
        self.db = self.client['logs_and_video']
        self.nova_client = Nova()
    
    def create_stream(self, id, job_description, log_cases, critical_cases, critical_phone_number):
        """
        This function creates a new stream to monitor
        Args:
            id (str): The unique ID for the stream
            job_description (str): A description of what is being surveilled (e.g. "a retail store entrance")
            log_cases (list): A list of cases that should be logged as "log"
            critical_cases (list): A list of cases that should be logged as "critical"
            critical_phone_number (str): The phone number to call in case of a critical event
        """
        if id in self.ids:
            return {"Error": "Stream ID already exists"}
        self.ids[id] = {
            "job_description": job_description,
            "log_cases": log_cases,
            "critical_cases": critical_cases,
            "critical_phone_number": critical_phone_number
        }
        self.db['metadata'].insert_one({
            "id": id,
            "job_description": job_description,
            "log_cases": log_cases,
            "critical_cases": critical_cases,
            "critical_phone_number": critical_phone_number
        })
    
    def get_stream(self, id):
        """
        Returns all the data for a specific stream
        """
        if id not in self.ids:
            return {"Error": "Stream ID not found"}
        meta = self.db['metadata'].find_one({"id": id})
        it = self.db[id].find()
        return {'metadata': meta, 'logs': list(it)}

    def delete_stream(self, id):
        if id not in self.ids:
            return 1
        del self.ids[id]
        self.db[id].drop()
        self.db['metadata'].delete_one({"id": id})
        return 0

    def analyze(self, id, video_bytes, timestamp):
        """
        This function analyses the video bytes using Nova and logs it if it is not normal.
        Args:
            id (str): The stream ID (You made this when you created the stream)
            video_bytes (bytes): The video bytes to analyze (base64 encoded)
            timestamp (str): The timestamp of the video.
        """
        video_desc = self.nova_client.describe_video(video_bytes, self.ids[id]['job_description'])
        json_response = self.nova_client.call(self.ids[id]['job_description'], 
                                              self.ids[id]['log_cases'], self.ids[id]['critical_cases'],
                                              video_desc)
        response = json.loads(json_response)
        if response['severity'] != 'normal':
            self.log(id, timestamp, response['severity'], response['description'], video_bytes)
            if response['severity'] == 'critical' and self.ids[id]['critical_phone_number'] is not None:
                self.vapi_call(self.ids[id]['critical_phone_number'], timestamp, response['description'])

    def log(self, id, timestamp, severity, description, video_bytes):
        if id not in self.ids:
            return 1
        self.db[id].insert_one({
            "severity": severity,
            'timestamp': timestamp,
            "description": description,
            "video_bytes": video_bytes
        })
        return 0

    def vapi_call(self, phone_no, timestamp, description):
        context = f"""
        You are an assistant that makes outbound calls to users to notify them of critical events detected by a security system.
        Inform the user that {description} occurred at {timestamp}."""
        assistant = self.vapi_client.assistants.create(
            name="Jamie",
            model={
                "provider": "openai",
                "model": "gpt-4o",
                "messages": [{"role": "system", "content": context}],
            },
            voice={"provider": "11labs", "voiceId": "cgSgspJ2msm6clMCkdW9"},
            first_message=f"Hey there, I'm calling to inform you that a critical event was detected by your security system at {timestamp}. Do you have time to discuss it now?",
        )
        self.vapi_client.calls.create(
            assistant_id=assistant.id,
            phone_number_id=self.phone_no_id,
            customer={"number": phone_no},
        )

master_instance = master('331350eb-8fbb-4b7e-a1ae-172e4736c0f9', '13ee495f-19a9-4692-aefb-4d3c6e9ddf0e')
master_instance.create_stream(
    id="stream1",
    job_description="a retail store entrance",
    log_cases=[
        "A customer enters the store."
    ],
    critical_cases=[
        "Someone starts laughing loudly and smiling."
    ],
    critical_phone_number="+18584423152"
)
with open('backend/vid.mp4', 'rb') as f:
    master_instance.analyze(
        id="stream1",
        video_bytes=base64.b64encode(f.read()).decode('utf-8'),
        timestamp="2024-10-01T12:00:00Z"
    )

master_instance.delete_stream("stream1")