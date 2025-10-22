# AcopleBot

<img width="605" height="412" alt="image" src="https://github.com/user-attachments/assets/86eaa190-0724-4ba9-a585-1d6e7169433b" />

# Video Demostrativo
https://github.com/user-attachments/assets/c7ce3b98-7b0b-44ab-b9bf-c0f4fff7fb6d

> [!IMPORTANT]
> # Need 

# Debian/Ubuntu:
```
sudo apt-get install webp jq nodejs python-pip -y

```

# Arch Linux:
```
sudo pacman -S libwebp jq nodejs npm python-pip --noconfirm --needed

```
#Termux:

```


Estructura Universal del Mensaje
Si una plataforma no es compatible solo pondra "null"


Cada script debe tener
ABMetaInfo({
  pattern: 'echo ?(.*)', // en caso de ser plugin
  url: 'link' //para autoactualizar
  sudo: false, // plugin responde a admin
  desc: 'descripcion del plugin',
  type: 'utilidad',
  deps: ['cfonts', 'baileys@12.5'] // dependencias node
})

los adaptadores solo tienen la info dependencia



# Sistema Universal de Mensajes - Documentación

## Estructura del Mensaje Universal

```json
{
  "universalId": "uuid-generado-por-adaptador",
  "timestamp": 1234567890,
  "platform": "telegram|discord|matrix|whatsapp|slack|etc",
  "adapterId": "nombre-instancia-adaptador", 
  "eventType": "message|edit|delete|reaction|join|leave|ban|pin|api|error",

  "server": {
    "id": "server_id", // null si no aplica (Telegram, WhatsApp)
    "name": "Server Name"
  },
  "conversation": {
    "id": "chat_channel_room_id",
    "name": "Nombre del chat/canal",
    "type": "private|group|channel|thread|dm"
  },
  "thread": {
    "id": "thread_id", // null si no es hilo o tema
    "name": "Thread Name"
  },

  "author": {
    "id": "user_id",
    "username": "username",
    "displayName": "Display Name",
    "avatarUrl": "https://...", // null si no tiene
    "avatarPath": "./media/file.jpg", 
    "bot": false
  },

  "message": {
    "id": "message_id_nativo",
    "text": "Contenido del mensaje", 
    "textFormatted": "<b>HTML</b> o markdown", // null si no soporta formato
    "replyTo": {
      "messageId": "id_mensaje_original_en_la_plataforma",
      "universalId": "uuid_si_existe",
      "text": "texto_citado_resumido",
      "author": {
        "id": "user_id_autor_original",
        "username": "username_autor",
        "displayName": "Display Name",
        "avatarUrl": "https://..."
      }
    },
    "edited": true, // solo true si fue editado
    "pinned": false
  },

  "attachments": [
    {
      "type": "image|video|audio|document|sticker|gif|voice|video_note",
      "fileUrl": "https://cdn.../file.jpg", // URL remota original
      "filePath": "./media/file.jpg", // ruta local descargada
      "filename": "document.pdf",
      "mimeType": "image/jpeg",
      "size": 1048576, // bytes
      "width": 1920, // null si no aplica
      "height": 1080,
      "duration": 120, // segundos, null si no aplica
      "caption": "Descripción"
    }
  ],

  "reaction": {
    "emoji": "👍",
    "messageId": "id_mensaje_reaccionado",
    "added": true // false si la quitó
  },

  "socialEvent": {
    "action": "join|leave|ban|kick|promote|demote|mute|unmute",
    "targetUser": {
      "id": "user_id",
      "username": "username", 
      "displayName": "Display Name"
    },
    "moderator": { /* mismo formato que targetUser, null si es automático */ },
    "reason": "Spam", // null si no hay razón
    "duration": 3600, // segundos, null si permanente
    "role": "Moderator" // para promote/demote
  },

  "configChange": {
    "setting": "title|description|photo|permissions|slowmode",
    "oldValue": "Valor anterior",
    "newValue": "Valor nuevo",
    "changedBy": { /* formato author */ }
  },

  "apiCall": {
    "api": "node-telegram-bot-api",
    "command": " bot.sendMessage(chatId, 'Received your message');"
    "api": "node-telegram-bot-api|discord.js|matrix-sdk", // pueden ser varios asi un script ejecutar diferentes acciones en diferentes apis
    "command": "comando_especifico"
  },

  "raw": { /* datos originales de la API de la plataforma */ }
}
```

