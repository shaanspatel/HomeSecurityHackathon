import sys
import json
from master import master
from credentials import VAPI_API_KEY, VAPI_PHONE_NUMBER_ID

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Stream ID required"}))
        sys.exit(1)
    
    stream_id = "general_watch"
    
    try:
        # Initialize master instance
        master_instance = master(VAPI_API_KEY, VAPI_PHONE_NUMBER_ID)
        
        # Get stream data (logs)
        stream_data = master_instance.get_stream(stream_id)
        
        # Return logs as JSON
        print(json.dumps({"items": stream_data.get("logs", [])}))
        
    except Exception as e:
        print(json.dumps({"error": str(e), "items": []}))
        sys.exit(1)

if __name__ == "__main__":
    main()
