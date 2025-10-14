// COLE ESTE CÓDIGO NO ARQUIVO: src/Platform/Cache/cache.service.js

import Database from 'better-sqlite3';
import path from 'path';
import { log, error } from '../../utils/logger.service.js';

// O arquivo do banco de dados será criado na raiz do projeto
const dbPath = path.join(process.cwd(), 'linkedin_cache.sqlite');
const db = new Database(dbPath);

// Cria todas as tabelas necessárias na primeira vez que o serviço é carregado
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    linkedinUsername TEXT PRIMARY KEY,
    scrapedData TEXT NOT NULL,
    lastScrapedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS interview_kit_weights (
    kit_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 2, /* 1=Baixo, 2=Médio, 3=Alto */
    PRIMARY KEY (kit_id, skill_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', -- 'user' ou 'admin'
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
`);

log('✅ Serviço de cache e tabelas SQLite inicializados com sucesso.');

/**
 * Busca um perfil no cache do SQLite.
 * @param {string} linkedinUsername - O username do LinkedIn.
 * @returns {{ profile: object, lastScrapedAt: number } | null}
 */
export const getCachedProfile = (linkedinUsername) => {
    try {
        const stmt = db.prepare('SELECT scrapedData, lastScrapedAt FROM profiles WHERE linkedinUsername = ?');
        const row = stmt.get(linkedinUsername);

        if (row) {
            return {
                profile: JSON.parse(row.scrapedData),
                lastScrapedAt: row.lastScrapedAt
            };
        }
        return null;
    } catch (err) {
        error("Erro ao buscar perfil no cache SQLite:", err.message);
        return null;
    }
};

/**
 * Salva ou atualiza um perfil no cache do SQLite.
 * @param {string} linkedinUsername - O username do LinkedIn.
 * @param {object} profileData - O objeto JSON completo do scraping.
 */
export const saveCachedProfile = (linkedinUsername, profileData) => {
    try {
        const stmt = db.prepare(`
            INSERT INTO profiles (linkedinUsername, scrapedData, lastScrapedAt)
            VALUES (?, ?, ?)
            ON CONFLICT(linkedinUsername) DO UPDATE SET
                scrapedData = excluded.scrapedData,
                lastScrapedAt = excluded.lastScrapedAt
        `);
        
        const info = stmt.run(
            linkedinUsername,
            JSON.stringify(profileData),
            Date.now()
        );
        log(`Perfil de "${linkedinUsername}" salvo/atualizado no cache SQLite.`);
        return info.changes > 0;
    } catch (err) {
        error("Erro ao salvar perfil no cache SQLite:", err.message);
        return false;
    }
};

/**
 * Verifica o status do cache para um perfil, retornando apenas metadados.
 * @param {string} linkedinUsername - O username do LinkedIn.
 * @returns {{ hasCache: boolean, lastScrapedAt: number | null }}
 */
export const getCacheStatus = (linkedinUsername) => {
    try {
        const stmt = db.prepare('SELECT lastScrapedAt FROM profiles WHERE linkedinUsername = ?');
        const row = stmt.get(linkedinUsername);
        if (row) {
            return { hasCache: true, lastScrapedAt: row.lastScrapedAt };
        }
        return { hasCache: false, lastScrapedAt: null };
    } catch (err) {
        error("Erro ao verificar status do cache SQLite:", err.message);
        return { hasCache: false, lastScrapedAt: null };
    }
};

// Exporta a instância do banco de dados para ser usada por outros serviços
export default db;