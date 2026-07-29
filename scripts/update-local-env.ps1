param(
  [Parameter(Mandatory = $true)]
  [string]$EnvFile,

  [string]$RedisPassword = "mahjong_redis_local_password",
  [string]$PostgresPort = "15432"
)

if (!(Test-Path $EnvFile)) {
  $example = Join-Path (Split-Path $EnvFile -Parent) ".env.example"
  Copy-Item $example $EnvFile
}

$lines = @(Get-Content $EnvFile)
$values = [ordered]@{
  DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:$PostgresPort/mahjong"
  REDIS_PASSWORD = $RedisPassword
  REDIS_URL = "redis://:$RedisPassword@127.0.0.1:6379"
}

foreach ($key in $values.Keys) {
  $found = $false
  $lines = $lines | ForEach-Object {
    if ($_ -match "^$([regex]::Escape($key))=") {
      $found = $true
      "$key=$($values[$key])"
    } else {
      $_
    }
  }
  if (!$found) {
    $lines += "$key=$($values[$key])"
  }
}

Set-Content -Path $EnvFile -Value $lines
