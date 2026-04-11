FROM python:3.12-slim

# libmagic for file type detection
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 ffmpeg libchromaprint-tools && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

ENV PORT=8080
EXPOSE 8080
CMD ["uvicorn", "src.server:app", "--host", "0.0.0.0", "--port", "8080"]
