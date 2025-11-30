#!/bin/bash




TERMUX_PACKAGES="python nano clang make git ffmpeg nodejs-lts pkg-config libxml2 libxslt matplotlib xorgproto rust imagemagick binutils wget build-essential libvips python-pip glib openjdk-25 file libsqlite sqlite valkey"

APT_PACKAGES="git nodejs ffmpeg python3 npm valkey"

PACMAN_PACKAGES="git nodejs ffmpeg python npm valkey"

TERMUX_EXEC="git clone https://github.com/weskerty/AcopleBot.git && cd AcopleBot && npm install && npm start"
APT_EXEC="git clone https://github.com/weskerty/AcopleBot.git && cd AcopleBot && npm install && npm start"
PACMAN_EXEC="git clone https://github.com/weskerty/AcopleBot.git && cd AcopleBot && npm install && npm start"






A1="\e[1;33m📦 %s detectado\e[0m\n"
A2="\e[1;32m📦 Actualizando...\e[0m"
A3="\e[1;32m⚙️ Instalando paquetes...\e[0m"
A4="\e[1;32m🚀 Iniciando...\e[0m"
echo -e "\e[1;36m┌────────────────────────────┐\e[0m"
echo -e "\e[1;36m│\e[1;32m🔮Instaler Instalador\e[0m"
echo -e "\e[1;36m└────────────────────────────┘\e[0m"
if uname -a | grep -q "Android"; then
  PM="Termux"
  echo -e "\e[1;33m⚠️ ACEPTA LOS PERMISOS \e[0m"
  echo -e "\e[1;33m⚠️ ACCEPT/GRANT PERMISSIONS \e[0m"
  sleep 4
  termux-setup-storage
  sleep 5
  termux-wake-lock
  pkg install -y tur-repo x11-repo
  echo -e "$A2"
  pkg update && yes "Y" | pkg upgrade -y
  echo -e "$A3"
  pkg install -y $TERMUX_PACKAGES
  pip install cython wheel setuptools python-dotenv
  export ANDROID_NDK_HOME=~/android-ndk/android-ndk-r27b && \
  export PATH=$ANDROID_NDK_HOME:$PATH && \
  mkdir -p ~/.gyp && \
  mkdir -p ~/android-ndk && \
  echo -e "\e[1;32m⬇️ Android NDK...\e[0m"
  wget -O ~/android-ndk.zip https://github.com/lzhiyong/termux-ndk/releases/download/android-ndk/android-ndk-r27b-aarch64.zip && \
  unzip ~/android-ndk.zip -d ~/android-ndk && \
  rm ~/android-ndk.zip && \
  curl -fsSL https://raw.githubusercontent.com/weskerty/MysticTools/refs/heads/main/Utilidades/Lev/include.gypi -o ~/.gyp/include.gypi
  echo -e "$A4"
  eval "$TERMUX_EXEC"
else
  if command -v pacman >/dev/null 2>&1; then
    PM="Pacman"
    printf "$A1" "$PM"
    echo -e "$A3"
    sudo pacman -Sy --noconfirm --needed $PACMAN_PACKAGES
    echo -e "$A4"
    eval "$PACMAN_EXEC"
  elif command -v apt-get >/dev/null 2>&1; then
    PM="APT"
    printf "$A1" "$PM"
    echo -e "$A2"
    sudo apt-get update && sudo apt-get upgrade -y
    echo -e "$A3"
    sudo apt-get install -y $APT_PACKAGES
    echo -e "$A4"
    eval "$APT_EXEC"
  fi
fi
