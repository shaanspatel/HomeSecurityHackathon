import sys
from vapi import Vapi
from credentials import VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, DEFAULT_CRITICAL_PHONE_NUMBER

def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CRITICAL_PHONE_NUMBER
    print(f"Placing test call to {dest} ...")
    client = Vapi(token=VAPI_API_KEY)

    assistant = client.assistants.create(
        name="Test Caller",
        model={
            "provider": "openai",
            "model": "gpt-4o",
            "messages": [{"role": "system", "content": "You are a short, friendly caller for test purposes."}],
        },
        voice={"provider": "11labs", "voiceId": "cgSgspJ2msm6clMCkdW9"},
        first_message="Pleaseee Liz I need thisss im kinda homeless. Hello Elizabeth Khoury, this is chatgpt model GLIZZY. Your roomate's breath stinks.",
    )

    call = client.calls.create(
        assistant_id=assistant.id,
        phone_number_id=VAPI_PHONE_NUMBER_ID,
        customer={"number": dest},  
    )
    print("Call created:", getattr(call, "id", call))

if __name__ == "__main__":
    main()