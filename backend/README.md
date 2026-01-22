# Backend API

Python FastAPI backend for handling OpenAI API calls.

## Setup

1. Create a virtual environment:
```bash
python -m venv venv
```

2. Activate the virtual environment:
```bash
# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Create a `.env` file and add your OpenAI API key:
```
OPENAI_API_KEY=your_actual_api_key_here
```

5. Run the server:
```bash
python main.py
```

The API will be available at `http://localhost:8000`

## Endpoints

- `GET /` - Health check
- `POST /api/chat` - Send chat messages to OpenAI
