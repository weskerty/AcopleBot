import { createClient } from 'matrix-js-sdk';

const client = createClient({
    baseUrl: 'https://matrix.org'  
});

async function login() {
    try {
        const response = await client.loginWithPassword(
            '@lawiskapy:matrix.org', //usuario
            'MiNumero097' //contraseña
        );
        
        console.log('Access Token:', response.access_token);
        console.log('User ID:', response.user_id);
        console.log('Device ID:', response.device_id);
    } catch (error) {
        console.error('Login failed:', error);
    }
}

login();