// src/Inhire/Auth/auth.service.js

import axios from 'axios';

const AUTH_API_URL = process.env.INHIRE_AUTH_API_URL;
const TENANT_ID = process.env.INHIRE_TENANT;

export const loginInhire = async (email, password) => {
  const loginUrl = `${AUTH_API_URL}/login`;
  console.log(`Tentando autenticar no endpoint: ${loginUrl}`);

  try {
    const response = await axios.post(loginUrl, {
      email,
      password,
    }, {
      headers: {
        'X-Tenant': TENANT_ID
      }
    });

    const { accessToken, refreshToken } = response.data;
    console.log("Login realizado com sucesso. Tokens recebidos.");
    
    return { accessToken, refreshToken };

  } catch (error) {
    console.error("Erro ao realizar o login na InHire:", error.response?.data || error.message);
    return null;
  }
};

/**
 * Usa o refreshToken para obter um novo accessToken.
 * @param {string} currentRefreshToken - O token de refresh que já temos.
 * @returns {Promise<{accessToken: string, refreshToken: string} | null>} Um novo par de tokens ou null em caso de erro.
 */
export const refreshInhireToken = async (currentRefreshToken) => {
  const refreshUrl = `${AUTH_API_URL}/refresh`;
  console.log(`Tentando renovar o token no endpoint: ${refreshUrl}`);

  try {
    const response = await axios.post(refreshUrl, {
      refreshToken: currentRefreshToken, // Sempre usa o token atual para a requisição
    }, {
      headers: {
        'X-Tenant': TENANT_ID
      }
    });

    const { accessToken, refreshToken: newRefreshTokenFromApi } = response.data;
    console.log("Token de acesso renovado com sucesso.");

    // ==========================================================
    // CORREÇÃO APLICADA AQUI
    // ==========================================================
    // Se a API retornar um novo refresh token, use-o.
    // Caso contrário, REUTILIZE o refresh token antigo que já era válido.
    const finalRefreshToken = newRefreshTokenFromApi || currentRefreshToken;

    return { accessToken, refreshToken: finalRefreshToken };

  } catch (error) {
    console.error("Erro ao renovar o token da InHire:", error.response?.data || error.message);
    return null;
  }
};