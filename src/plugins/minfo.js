import { parentPort } from 'worker_threads';

const ABMetaInfo = () => {};
ABMetaInfo({
pattern: 'minfo',
url: '',
sudo: true,
desc: 'RAW Mensaje',
type: 'debug',
deps: []
});

parentPort.on('message', async (msg) => {
try {
const { message, fullContext } = msg;
let target = message;
if (message.message?.replyTo?.universalId && fullContext?.message?.replyTo) target = fullContext.message.replyTo;
parentPort.postMessage({
type: 'response',
originalMessage: message,
response: {
text: JSON.stringify(target) + '\n' + JSON.stringify(message)
}
});
} catch (err) {
parentPort.postMessage({
type: 'error',
message: `Error${err.message}`
});
}
});
