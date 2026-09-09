FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN mkdir -p /app/data
# No VOLUME instruction here — Railway doesn't support it in the Dockerfile;
# attach a Railway Volume mounted at /app/data via the dashboard instead.

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
