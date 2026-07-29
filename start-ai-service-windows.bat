@echo off
setlocal
set "ROOT=%~dp0"
set "AI_VENV=%ROOT%.venv-ai"
set "MODEL_PATH=%ROOT%model\v3-lite.zip"
set "MODEL_CONFIG=%ROOT%model\config\ppo_v3_lite_action_value_bc_finetune.yaml"

if not defined SB3_ALGO set "SB3_ALGO=MASKABLEPPO"

cd /d "%ROOT%" || exit /b 1

"%AI_VENV%\Scripts\python.exe" -c "import ai_service.server" >nul 2>nul
if not errorlevel 1 (
  echo Full /predict AI server is available.
  "%AI_VENV%\Scripts\python.exe" -m ai_service.server --host 0.0.0.0 --port 8001 --model "%MODEL_PATH%" --config "%MODEL_CONFIG%"
) else (
  echo WARN: ai_service.server is missing training package dependencies.
  echo Falling back to compatibility /ai/act server.
  set "SB3_MODEL_PATH=%MODEL_PATH%"
  "%AI_VENV%\Scripts\python.exe" -m uvicorn ai_service.sb3_server:app --host 0.0.0.0 --port 8001
)
