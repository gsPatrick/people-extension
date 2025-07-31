// src/Inhire/inhireCore.js

import axios from 'axios';
import { getTokens, saveTokens } from './Auth/authStorage.service.js';
import { refreshInhireToken } from './Auth/auth.service.js';

const inhireCore = axios.create({});

// Interceptor de Requisição (sem alterações)
inhireCore.interceptors.request.use(
  async (config) => {
    const { accessToken } = await getTokens();
    config.headers['X-Tenant'] = process.env.INHIRE_TENANT;
    if (accessToken) {
      config.headers['Authorization'] = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor de Resposta (Refinado)
inhireCore.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      console.log("Token de acesso expirado. Tentando renovar...");
      const { refreshToken: currentRefreshToken } = await getTokens();
      
      if (currentRefreshToken) {
        try {
          // A função `refreshInhireToken` agora recebe o refresh token atual
          const newTokens = await refreshInhireToken(currentRefreshToken);
          
          if (newTokens && newTokens.accessToken) {
            await saveTokens(newTokens);
            
            // Atualiza o cabeçalho da requisição original e a reenvia
            originalRequest.headers['Authorization'] = `Bearer ${newTokens.accessToken}`;
            console.log("Token renovado com sucesso. Reenviando a requisição original.");
            return inhireCore(originalRequest);
          }
        } catch (refreshError) {
          console.error("Falha crítica ao renovar o token. O usuário pode precisar fazer login novamente.", refreshError);
          // Adicionar lógica de logout aqui, se necessário.
          // Ex: clearTokens(); window.location.reload();
          return Promise.reject(refreshError);
        }
      }
    }
    
    return Promise.reject(error);
  }
);

export default inhireCore;