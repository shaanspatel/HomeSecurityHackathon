import sys
import json
import subprocess
import tempfile
import os
from master import master
from credentials import VAPI_API_KEY, VAPI_PHONE_NUMBER_ID

def convert_to_mp4(video_bytes):
    """Convert video bytes to MP4 format using ffmpeg, with fallback"""
    try:
        # First check if ffmpeg is available
        ffmpeg_check = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True)
        if ffmpeg_check.returncode != 0:
            print(f"[WARNING] FFmpeg not available, trying direct upload...", file=sys.stderr)
            return video_bytes  # Return original bytes as fallback
        
        # Create temporary files
        with tempfile.NamedTemporaryFile(suffix='.input', delete=False) as input_file:
            input_file.write(video_bytes)
            input_path = input_file.name
        
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as output_file:
            output_path = output_file.name
        
        # Use ffmpeg to convert to MP4
        cmd = [
            'ffmpeg', '-i', input_path, 
            '-c:v', 'libx264',  # Use H.264 codec
            '-c:a', 'aac',      # Use AAC audio codec
            '-movflags', '+faststart',  # Optimize for streaming
            '-y',               # Overwrite output file
            output_path
        ]
        
        print(f"[DEBUG] Converting video with ffmpeg...", file=sys.stderr)
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"[ERROR] ffmpeg conversion failed: {result.stderr}", file=sys.stderr)
            print(f"[WARNING] Falling back to original video format...", file=sys.stderr)
            # Clean up and return original bytes
            os.unlink(input_path)
            os.unlink(output_path)
            return video_bytes
        
        # Read the converted video
        with open(output_path, 'rb') as f:
            converted_bytes = f.read()
        
        print(f"[DEBUG] Video converted successfully: {len(converted_bytes)} bytes", file=sys.stderr)
        
        # Clean up temporary files
        os.unlink(input_path)
        os.unlink(output_path)
        
        return converted_bytes
        
    except FileNotFoundError:
        print(f"[WARNING] FFmpeg not found, using original video format...", file=sys.stderr)
        return video_bytes
    except Exception as e:
        print(f"[ERROR] Video conversion failed: {str(e)}", file=sys.stderr)
        print(f"[WARNING] Falling back to original video format...", file=sys.stderr)
        # Clean up temporary files if they exist
        try:
            if 'input_path' in locals():
                os.unlink(input_path)
            if 'output_path' in locals():
                os.unlink(output_path)
        except:
            pass
        return video_bytes  # Return original bytes as fallback

def main():
    
    device_id = "general_watch"
    
    try:
        # Initialize master instance
        master_instance = master(VAPI_API_KEY, VAPI_PHONE_NUMBER_ID)
        
        # Always create stream (create_stream handles duplicates gracefully)
        master_instance.create_stream(
            id=device_id,
            context="home surveillance",
            critical_phone_number=None  # Use default from credentials
        )
        
        # Read video data from stdin
        video_bytes = sys.stdin.buffer.read()
        
        if not video_bytes:
            print(json.dumps({"error": "No video data received"}))
            sys.exit(1)
        
        print(f"[DEBUG] Received {len(video_bytes)} bytes of video data", file=sys.stderr)
        print(f"[DEBUG] Device ID: {device_id}", file=sys.stderr)
        
        # Convert video to MP4 format if needed (with fallback)
        print(f"[DEBUG] Converting video to MP4 format...", file=sys.stderr)
        converted_video_bytes = convert_to_mp4(video_bytes)
        
        # Note: convert_to_mp4 now returns original bytes as fallback, never None
        
        # Analyze video
        print(f"[DEBUG] Starting video analysis...", file=sys.stderr)
        try:
            result = master_instance.analyze(device_id, converted_video_bytes)
            print(f"[DEBUG] Analysis completed successfully", file=sys.stderr)
        except Exception as analyze_error:
            print(f"[ERROR] Analysis failed: {str(analyze_error)}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            print(json.dumps({"error": f"Analysis failed: {str(analyze_error)}"}))
            sys.exit(1)
        
        # Return result as JSON
        print(json.dumps(result))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()