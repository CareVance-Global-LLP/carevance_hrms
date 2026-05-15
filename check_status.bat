@echo off
setlocal EnableDelayedExpansion

echo ============================================================
echo CareVance Server Status Check
echo ============================================================
echo.

REM Configuration
echo Please enter your AWS Lightsail server details:
set /p AWS_HOST="Server IP or Hostname: "
set /p AWS_USER="Username (usually ubuntu): "
set /p AWS_KEY="Path to SSH key (.pem file): "

echo.
echo ============================================================
echo Running status check...
echo ============================================================
echo.

ssh -i "%AWS_KEY%" %AWS_USER%@%AWS_HOST% "bash -s" < "D:\CareVance_Hrms_IDE\check_server_status.sh"

echo.
echo ============================================================
echo Status check complete!
echo ============================================================
echo.
echo Copy the output above and paste it here if you need help.
echo.
pause
