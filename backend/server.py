from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
import boto3
from boto3.dynamodb.conditions import Key
from .credentials import (
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    DYNAMODB_REGION,
    DYNAMODB_LOGS_TABLE,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

dynamodb = boto3.resource(
    "dynamodb",
    region_name=DYNAMODB_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
)
logs_table = dynamodb.Table(DYNAMODB_LOGS_TABLE)

@app.get("/api/logs")
def get_logs(stream_id: str = Query("general_watch"), limit: int = 100):
    try:
        resp = logs_table.query(
            KeyConditionExpression=Key("stream_id").eq(stream_id),
            ScanIndexForward=False,
            Limit=limit,
        )
        items = resp.get("Items", [])
        return JSONResponse(content=jsonable_encoder({"items": items}))
    except Exception as e:
        return JSONResponse(content={"items": [], "error": str(e)}, status_code=500)

@app.get("/health")
def health():
    return {"status": "ok"}