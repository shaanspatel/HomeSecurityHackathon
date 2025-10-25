import base64
from nova import Nova

def test_bedrock(video_path):
    with open(video_path, "rb") as f:
        video_bytes = f.read()  # Read raw bytes directly
    
    nova = Nova()
    description = nova.describe_video(video_bytes, job_description="a retail store")  # Pass raw bytes
    print("Video Description:", description)

if __name__ == "__main__":
    test_bedrock("vid.mp4")  # Ensure this video file exists