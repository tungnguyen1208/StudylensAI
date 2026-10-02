FROM python:3.12.7-slim@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt \
    && addgroup --system --gid 10001 studylens \
    && adduser --system --uid 10001 --ingroup studylens --home /app studylens

COPY --chown=studylens:studylens app/ ./app/
USER studylens
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
