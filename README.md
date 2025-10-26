# Safe Vision

Safe Vision is an intelligent home security application that combines real-time video monitoring with AI-powered threat detection and automated alerting capabilities.

## Features

### User Authentication
- Secure login system with session management
- Persistent authentication and stores user data using Cognito


### Video Monitoring
- Real-time camera preview and recording
- Automatic clip segmentation and upload
- Manual clip cutting for important moments
- Support for device selection

### AI-Powered Detection
- Automatic threat detection using AWS Bedrock
- Intelligent scene analysis and classification
- Real-time processing of video clips

### Automated Alerts
- VAPI integration for phone call alerts
- Configurable critical phone numbers
- Context-aware alerting based on detection severity

### Cloud Storage & Logging
- AWS S3 for video storage
- DynamoDB for metadata and logs
- Persistent logging with timestamps
- Queryable stream history


## Tech Stack

### Frontend
- **React 19** - Modern React with hooks
- **Vite** - Fast build tool and dev server
- **Express.js** - API server for video uploads
- **Multer** - File upload handling

### Backend (Python)
- **FastAPI** - REST API server
- **AWS Services**:
  - **Bedrock** - AI model inference
  - **S3** - Video storage
  - **DynamoDB** - Metadata and logs
  - **Cognito** - Authentication
- **VAPI** - Phone call automation

