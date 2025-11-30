
los adaptadores deben aceptar todos los mensajes de web-user, web y bot aunque no haya reglas (incluye plugin). ASi no ignorar de estos usuarios si solicitan enviar a ciertos id chat
api ejecucion adaptadores para coandos como kick, cambiar imagen de grupo


plugin handler worker.on('exit') ser agregado en cada plugin

eliminar totalmente cola de ejecucion. Si no hay SUDO_USERS= el plugin .setvar debe funcionar con cualquiera, actualmente pluginhandler niega la ejecucion de .setvar si no hay ningun sudo, pero setvar debe funcionar especificamente para todos cuando no hay ningun sudo, ya que significa que esta en modo configuracion. Cuando ya existe la variable SUDO_USERS= ahi el pluginhanler vuelve a bloquear la ejecucion de setvar solo para sudo.

el pluginhanler tendra comando .menu que listara en un mensaje; todos los abmetainfo cargados con este estilo;
´Pattern´ $Descripcion
> Dependencias

´Pattern´ $Descripcion
> Dependencias

Basicamente; .menu estara integrados en pluginhandler
De esta manera el .menu para que utilice la cache de abmetainfo del propio handlerplugin
