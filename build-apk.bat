@echo off
setlocal enabledelayedexpansion

echo ======================================================
echo    ONESPORT - Build Android APK Generator
echo ======================================================
echo.

echo [1/3] Menyinkronkan asset web terbaru ke folder Android...
if not exist "android\app\src\main\assets" mkdir "android\app\src\main\assets"
copy /Y "index.html" "android\app\src\main\assets\index.html" >nul
copy /Y "badminton-service.js" "android\app\src\main\assets\badminton-service.js" >nul
copy /Y "minisoccer.html" "android\app\src\main\assets\minisoccer.html" >nul
copy /Y "badminton.html" "android\app\src\main\assets\badminton.html" >nul
copy /Y "manifest.json" "android\app\src\main\assets\manifest.json" >nul
copy /Y "sw.js" "android\app\src\main\assets\sw.js" >nul
copy /Y "logo*.png" "android\app\src\main\assets\" >nul
echo [OK] Sinkronisasi asset web selesai!
echo.

echo [2/3] Memeriksa Java Development Kit (JDK 17+)...
where java >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [PERHATIAN] Java (JDK) belum terdeteksi di PATH komputer Anda.
    echo.
    echo Untuk menginstal JDK 17 secara otomatis di Windows, jalankan:
    echo     winget install Microsoft.OpenJDK.17
    echo atau pasang Android Studio: https://developer.android.com/studio
    echo.
    echo Setelah JDK terpasang, jalankan kembali build-apk.bat ini.
    echo.
    echo CATATAN: Anda juga bisa build APK otomatis GRATIS via GitHub Actions
    echo cukup lakukan 'git push' ke GitHub, file APK akan otomatis muncul di menu Releases!
    echo.
    pause
    exit /b 1
)

echo [OK] Java terdeteksi!
java -version
echo.

echo [3/3] Memulai proses kompilasi Gradle APK...
cd android
call gradlew.bat assembleRelease
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ======================================================
    echo  [SUKSES] File APK berhasil dibuat!
    echo  Lokasi: android\app\build\outputs\apk\release\app-release.apk
    echo ======================================================
) else (
    echo.
    echo [ERROR] Kompilasi APK gagal. Periksa pesan error di atas.
)

cd ..
pause
