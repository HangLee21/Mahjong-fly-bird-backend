ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM ${PYTHON_BASE_IMAGE}

ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PYTORCH_WHEEL_URL=https://download.pytorch.org/whl/cpu/torch-2.12.0%2Bcpu-cp312-cp312-manylinux_2_28_x86_64.whl

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL}

WORKDIR /app

COPY ai_service/requirements.txt /tmp/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install "${PYTORCH_WHEEL_URL}" \
    && python -m pip install -r /tmp/requirements.txt

COPY ai_service ./ai_service
COPY mahjong_ai ./mahjong_ai

RUN useradd --create-home --uid 10001 mahjong \
    && chown -R mahjong:mahjong /app

USER mahjong

EXPOSE 8001

CMD ["python", "-m", "ai_service.server", "--host", "0.0.0.0", "--port", "8001", "--model", "/app/model/v3-lite.zip", "--config", "/app/model/config/ppo_v3_lite_action_value_bc_finetune.yaml"]
