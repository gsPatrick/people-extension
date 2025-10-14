// CRIE O ARQUIVO: src/Core/User-Flow/userService.js

import db from '../../Platform/Cache/cache.service.js';
import bcrypt from 'bcrypt';
import { log, error } from '../../utils/logger.service.js';

const SALT_ROUNDS = 10;

export const findUserByEmail = (email) => {
    try {
        const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
        return stmt.get(email);
    } catch (err) {
        error("Erro ao buscar usuário por email:", err.message);
        return null;
    }
};

export const createUser = async ({ name, email, password, role = 'user' }) => {
    try {
        const existingUser = findUserByEmail(email);
        if (existingUser) {
            throw new Error('Um usuário com este email já existe.');
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const now = Date.now();
        
        const stmt = db.prepare(
            'INSERT INTO users (name, email, password, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const info = stmt.run(name, email, hashedPassword, role, now, now);
        
        log(`Usuário '${name}' criado com sucesso com ID: ${info.lastInsertRowid}`);
        return { id: info.lastInsertRowid, name, email, role };
    } catch (err) {
        error("Erro ao criar usuário:", err.message);
        throw err;
    }
};

export const getAllUsers = () => {
    try {
        // Nunca retornar a senha, mesmo que hasheada
        const stmt = db.prepare('SELECT id, name, email, role, createdAt, updatedAt FROM users ORDER BY name ASC');
        return stmt.all();
    } catch (err) {
        error("Erro ao buscar todos os usuários:", err.message);
        return [];
    }
};

export const updateUser = async (id, { name, email, password, role }) => {
    try {
        const fields = [];
        const params = [];

        if (name) { fields.push('name = ?'); params.push(name); }
        if (email) { fields.push('email = ?'); params.push(email); }
        if (role) { fields.push('role = ?'); params.push(role); }
        if (password) {
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            fields.push('password = ?');
            params.push(hashedPassword);
        }

        if (fields.length === 0) {
            throw new Error("Nenhum campo para atualizar foi fornecido.");
        }

        fields.push('updatedAt = ?');
        params.push(Date.now());
        params.push(id);

        const stmt = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`);
        stmt.run(...params);
        log(`Usuário ID ${id} atualizado com sucesso.`);
        return true;
    } catch (err) {
        error(`Erro ao atualizar usuário ID ${id}:`, err.message);
        throw err;
    }
};

export const deleteUser = (id) => {
    try {
        const stmt = db.prepare('DELETE FROM users WHERE id = ?');
        const info = stmt.run(id);
        if (info.changes === 0) {
            throw new Error('Nenhum usuário encontrado com este ID.');
        }
        log(`Usuário ID ${id} deletado com sucesso.`);
        return true;
    } catch (err) {
        error(`Erro ao deletar usuário ID ${id}:`, err.message);
        throw err;
    }
};