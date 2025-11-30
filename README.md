# AcopleBot
Puente entre plataformas - Aplicacion de escritorio con multiples Cuentas - Plugins Multiplataforma - Facilmente Mantenible 

<img width="302" height="206" alt="image" src="https://github.com/user-attachments/assets/86eaa190-0724-4ba9-a585-1d6e7169433b" />
Eficiencia? Eso es otro tema...


# Video Demostrativo
https://github.com/user-attachments/assets/c4e59488-916f-4c54-9bec-b99c779660f2



# Plugins
Plugins MultiPlataforma y Extensible, Se pueden instalar mas plugins con el comando .plg

`DLA` DonwLoadAll; una envoltura/Wrapper de [yt-dlp](https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#readme) que permite buscar y descargar todo lo que solicites como Videos de Tiktok, Instagram, etc.

`gq` Grooq; IA que puede transcribir audios, leer imagenes y demas cosas de IA

`Dado` Envia un dado con numeracion aleatoria, Clon al emoji Dado de Telegram.

`cmd` Controla el servidor donde esta alojado el bot a traves de CLI (Shell Remoto). Solo SUDOUSERS pueden usarlo.


## En el futuro se espera agregar;
- [ ]  Recorte Multimedia, Union de Varios y demas relacionado
- [ ]  Stickers
- [ ]  Detector de Musica (similar a Shazam)
- [ ]  Juegos de Chat
- [ ]  Filto de Palabras (adapter plugin script)
- [ ]  Wiki/Diccionario Info
- [ ]  SysInfo
- [ ]  Detector de Virus (Subida archivo a VirusTotal)
- [ ]  Buscador de Archivos Interno, Subida y Descarga desde Servidor
- [ ]  Kick, Warn, Cambio de Imagen Unificado (llamada api)

Puedes Contribuir añadiendo mas Plugins o[ Mejorando esta Aberracion de Codigo](https://github.com/weskerty/AcopleBot/pulls)

![image](https://github.com/user-attachments/assets/a43891c0-e0e4-46a9-a7ad-b44d1b07913c)

Publica tu Plugin [Aqui](https://weskerty.github.io/MysticTools/web/Plugins/); (todavia no adaptado)

> [!IMPORTANT]
> # 

# Instalar
Pega esto en la Terminal para Auto Instalacion

```
curl -fsSL https://raw.githubusercontent.com/weskerty/AcopleBot/refs/heads/master/Extras/Install.sh | bash  

```

Probado en ArchLinux y Termux.
> [!IMPORTANT]
> El tiempo de instalacion en termux varia dependiendo de las capacidades del dispositivo, Acepta todos los permisos y no salgas de la App hasta Terminar el Proceso.

> [!IMPORTANT]
> Si el bot se cierra constantemente una vez iniciado, deberas seguir este Tutorial para Solucionar la Limitacion de Android:

# Configuracion
Al iniciar se abrira un editor de texto, deberas agregar las variables ahi. 
Requerido:
PLATAFORM_TOKEN
### Ejemplo:
TELEGRAM_T1 = "Tu Bot Token de t.me/BotFather" 
DISCORD_T1 = "Tu Bot Token de discord.com/developers" 

Guarda el Archivo y Listo.
El bot iniciara, para añadirte como administrador del bot envia al bot desde cualquier plataforma que hayas agregado (envia el mensaje al bot)
```
.setvar IMSUDO
```

Para añadir puentes envia:

```
.setvar REGLA#
```
desde los grupos que quieres vincular

### Ejemplo:
Grupo de Telegram:
.setvar REGLA1

Luego en Canal de Discord:
.setvar REGLA1

Luego . setvar REGLAOK
Y el puente estara listo. 
Repetir por cada grupo, mas reglas aumentando numeracion #




### Otras Variables;

 #General
MEDIA_FILE_MAX = "Maximo envio de Archivo en MB"
MEDIA_FOLDER= "Ubicacion de Multimedia Descargada"
PREFIX= "letra inicial para usar comandos, ejemplo ."
SUDO = ID de Plataforma que puede utilizar ciertos comandos (como cmd)

 #CUENTAS
 #Telegram 
TELEGRAM_T1 = "TuToken de Bot de t.me/BotFather" 
 #Discord
 #DISCORD_T1 = "token"


 #REGLAS
REGLA_1 = "Los Puentes por ID y tipo"






# Estructura Universal del Mensaje
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

