import base64
import json
import boto3

class Nova:
    def __init__(self):
        self.client = boto3.client("bedrock-runtime", region_name="us-east-2")
        self.messages = lambda video_bytes : [{"role": "user", "content": [
            {"text": "Describe the following video in detail."},  
            {"video": {
            "format": "mp4",
            "source": {"bytes": base64.b64decode(video_bytes)}
            }}]}]
    
    def describe_video(self, video_bytes, job_description):
        inf_params = {"maxTokens": 300, "topP": 0.1, "temperature": 0.3}
        additionalModelRequestFields = {
            "inferenceConfig": {
                "topK": 20
            }
        }
        model_response = self.client.converse(
            modelId="us.amazon.nova-lite-v1:0",
            messages=self.messages(video_bytes),
            system= [{"text": f"You are a helpful assistant watching {job_description} that accurately describes videos in detail. Provide a comprehensive description of the content, actions, and context within the video."}],
            inferenceConfig=inf_params,
            additionalModelRequestFields=additionalModelRequestFields
        )
        return model_response["output"]["message"]["content"][0]["text"]
    
    def call(self, job_description, log_cases, critical_cases, user):
        messages = [{"role": "user", "content": [{"text": user}]}]
        system =  [{"text": self.system_prompt(job_description, log_cases, critical_cases)}]
        response = self.client.converse(
            modelId="us.amazon.nova-micro-v1:0",
            system=system,
            messages=messages
        )
        return response["output"]["message"]["content"][0]["text"]
    
    def system_prompt(self, job_description, log_cases, critical_cases):
        head = f"""
        You are a security guard tasked with monitoring footage of {job_description}. You will be given a description of the last 10 seconds of footage. Based on that description, 
        you need to classify the situation into one of the following severities: "log", "critical", or "normal".
        """
        log_cases_text = ""
        for i, case in enumerate(log_cases):
            log_cases_text += f"\n{i+1}. {case}"
        critical_cases_text = ""
        for i, case in enumerate(critical_cases):
            critical_cases_text += f"\n{i+1}. {case}"
        
        tail = f"""
        These are the following cases that are considered "log" cases:{log_cases_text}
        These are the following cases that are considered "critical" cases:{critical_cases_text}
        Any situation not matching the above cases should be classified as "normal".

        You will also need to provide a brief explanation of what you saw and which case it matches to. Your output should be structured as a JSON object with the following format:

        {{
        "severity": "log" | "critical" | "normal",
        "description": "A clear and concise explanation of the footage and what case it matches to."
        }}

        Ensure that your response is strictly in JSON format without any additional text. If the situation does not match any of the log or critical cases, classify it as "normal" and provide an appropriate explanation.
        """
        return head + tail

if __name__ == "__main__":
    with open("backend/vid.mp4", "rb") as f:
        video_bytes = base64.b64encode(f.read()).decode("utf-8")
    nova = Nova()
    description = nova.describe_video(video_bytes, job_description="a retail store")
    print("Video Description:", description)
    out = nova.call(
        job_description="a retail store",
        log_cases=[
            "A customer is browsing items on the shelves.",
            "A customer is walking around the store without any suspicious behavior.",
            "An employee is restocking shelves."
        ],
        critical_cases=[
            "A customer is attempting to steal items from the store.",
            "A customer is acting aggressively towards staff or other customers.",
            "An individual is vandalizing store property."
        ],
        user=description)

    out = json.loads(out)
    print(out)