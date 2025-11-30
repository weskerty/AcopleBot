#!/bin/bash

read -p "baseUrl [https://matrix.org]: " baseUrl
baseUrl=${baseUrl:-https://matrix.org}

read -p "Usuario: " username

read -s -p "Contraseña: " password
echo 

echo "Conectando a $baseUrl con el usuario $username..."

node <<EOF
import { createClient } from 'matrix-js-sdk';

const client = createClient({
    baseUrl: '$baseUrl'
});

async function login() {
    try {
        const response = await client.loginWithPassword(
            '$username', // Usuario
            '$password'  // Contraseña
        );
        
        console.log('Inicio exitoso:');
        console.log('Access Token:', response.access_token);
        console.log('User ID:', response.user_id);
        console.log('Device ID:', response.device_id);
    } catch (error) {
        console.error('Error:', error);
    }
}

login();
EOF