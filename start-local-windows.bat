@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "BACKEND_ENV=%BACKEND_DIR%\.env"
set "AI_VENV=%ROOT%.venv-ai"
set "MODEL_PATH=%ROOT%model\v3-lite.zip"
set "LOG_DIR=%ROOT%logs"
set "BACKEND_LOG=%LOG_DIR%\backend-start.log"

if not defined SB3_ALGO set "SB3_ALGO=MASKABLEPPO"
if not defined REDIS_PASSWORD set "REDIS_PASSWORD=mahjong_redis_local_password"

echo [1/8] Checking model file...
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%MODEL_PATH%" (
  echo ERROR: Model file not found: "%MODEL_PATH%"
  echo Put v3-lite.zip under "%ROOT%model" first.
  pause
  exit /b 1
)

echo [2/8] Preparing backend .env...
if not exist "%BACKEND_ENV%" (
  copy "%BACKEND_DIR%\.env.example" "%BACKEND_ENV%" >nul
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\update-local-env.ps1" -EnvFile "%BACKEND_ENV%" -RedisPassword "%REDIS_PASSWORD%" -PostgresPort "15432"
if errorlevel 1 (
  echo ERROR: backend .env update failed.
  pause
  exit /b 1
)

echo [3/8] Starting PostgreSQL and Redis with Docker Compose...
pushd "%BACKEND_DIR%" || exit /b 1
docker compose up -d postgres redis
if errorlevel 1 (
  echo ERROR: docker compose up failed. Make sure Docker Desktop is running.
  popd
  pause
  exit /b 1
)
popd

echo Waiting for PostgreSQL and Redis...
set "READY="
for /L %%i in (1,1,30) do (
  docker exec mahjong_postgres pg_isready -U postgres -d mahjong >nul 2>nul
  if not errorlevel 1 (
    docker exec mahjong_redis redis-cli -a "%REDIS_PASSWORD%" ping >nul 2>nul
    if not errorlevel 1 (
      set "READY=1"
      goto services_ready
    )
  )
  timeout /t 1 /nobreak >nul
)
:services_ready
if not defined READY (
  echo ERROR: PostgreSQL or Redis did not become ready in time.
  pause
  exit /b 1
)

echo [4/8] Installing backend dependencies when needed...
if not exist "%BACKEND_DIR%\node_modules" (
  call npm.cmd --prefix "%BACKEND_DIR%" install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

echo [5/8] Preparing Prisma database...
echo Stopping old backend processes that may lock Prisma Client...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and ($_.CommandLine -like '*dist/src/main.js*' -or $_.CommandLine -like '*backend-start.log*' -or $_.CommandLine -like '*tsx*src/main.ts*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul
set "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:15432/mahjong"
set "REDIS_URL=redis://:%REDIS_PASSWORD%@127.0.0.1:6379"
call npm.cmd --prefix "%BACKEND_DIR%" run prisma:generate
if errorlevel 1 (
  echo ERROR: prisma generate failed.
  pause
  exit /b 1
)
call npm.cmd --prefix "%BACKEND_DIR%" exec prisma -- db push --schema "%BACKEND_DIR%\prisma\schema.prisma"
if errorlevel 1 (
  echo ERROR: prisma db push failed.
  pause
  exit /b 1
)
call npm.cmd --prefix "%BACKEND_DIR%" run seed
if errorlevel 1 (
  echo ERROR: seed failed.
  pause
  exit /b 1
)

echo [6/8] Launching backend...
echo Keep the "Mahjong Backend" window open. Closing it stops the backend.
echo Backend logs are shown in that window.
start "Mahjong Backend" /D "%BACKEND_DIR%" cmd.exe /k "call npm.cmd run build && call npm.cmd start"
echo Backend window launched. Continuing with health check and AI startup...

echo Waiting for backend http://localhost:3000/api/health ...
set "BACKEND_READY="
for /L %%i in (1,1,30) do (
  curl.exe -sS http://localhost:3000/api/health >nul 2>nul
  if not errorlevel 1 (
    set "BACKEND_READY=1"
    goto backend_ready
  )
  timeout /t 1 /nobreak >nul
)
:backend_ready
if not defined BACKEND_READY (
  echo ERROR: Backend did not pass health check.
  echo Check the "Mahjong Backend" window for the real error.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess | Format-Table -AutoSize"

echo [7/8] Preparing Python AI environment...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'python.exe' -or $_.Name -eq 'cmd.exe') -and ($_.CommandLine -like '*uvicorn*ai_service.sb3_server*' -or $_.CommandLine -like '*ai_service.server*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

where py >nul 2>nul
if errorlevel 1 (
  set "PYTHON_CMD=python"
) else (
  set "PYTHON_CMD=py"
)

if not exist "%AI_VENV%\Scripts\python.exe" (
  %PYTHON_CMD% -m venv "%AI_VENV%"
  if errorlevel 1 (
    echo ERROR: Python venv creation failed.
    pause
    exit /b 1
  )
)

"%AI_VENV%\Scripts\python.exe" -m pip install --upgrade pip
"%AI_VENV%\Scripts\python.exe" -m pip install -r "%ROOT%ai_service\requirements.txt"
if errorlevel 1 (
  echo ERROR: AI dependency install failed.
  pause
  exit /b 1
)

echo [8/8] Launching AI service...
start "Mahjong AI Service" /D "%ROOT%" cmd.exe /k call "%ROOT%start-ai-service-windows.bat"

echo Waiting for AI service http://localhost:8001/health ...
set "AI_READY="
for /L %%i in (1,1,30) do (
  curl.exe -sS http://localhost:8001/health >nul 2>nul
  if not errorlevel 1 (
    set "AI_READY=1"
    goto ai_ready
  )
  timeout /t 1 /nobreak >nul
)
:ai_ready
if not defined AI_READY (
  echo ERROR: AI service did not pass health check.
  echo Check the "Mahjong AI Service" window for the real error.
  pause
  exit /b 1
)

echo.
echo Backend: http://localhost:3000/api
echo WebSocket: ws://localhost:3000/ws?token=TOKEN
echo AI service: http://localhost:8001
echo.
echo Health checks:
echo   curl.exe http://localhost:3000/api/health
echo   curl.exe http://localhost:8001/health
echo.
pause
