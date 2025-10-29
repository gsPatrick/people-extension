// ARQUIVO COMPLETO E ATUALIZADO (VERSÃO PostgreSQL/Sequelize): src/Core/User-Flow/userService.js

import db from '../../models/index.js'; // Importa a instância dos models do Sequelize
import bcrypt from 'bcrypt';
import { log, error } from '../../utils/logger.service.js';

const SALT_ROUNDS = 10;

/**
 * Busca um usuário pelo email no PostgreSQL.
 * @param {string} email
 * @returns {Promise<object|null>} O usuário encontrado (objeto Sequelize) ou null.
 */
export const findUserByEmail = async (email) => {
    try {
        const user = await db.User.findOne({ where: { email } });
        // Retorna a instância do Sequelize, que é o que o bcrypt.compare espera depois.
        return user; 
    } catch (err) {
        error("Erro ao buscar usuário por email no PostgreSQL:", err.message);
        return null;
    }
};

/**
 * Cria um novo usuário no PostgreSQL.
 * @param {object} userData - { name, email, password, role }
 * @returns {Promise<object>} O novo usuário criado (objeto simples, sem a senha).
 */
export const createUser = async ({ name, email, password, role = 'user' }) => {
    try {
        const existingUser = await findUserByEmail(email); // AGORA É ASYNC, ENTÃO USAMOS await
        if (existingUser) {
            throw new Error('Um usuário com este email já existe.');
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        const newUser = await db.User.create({
            name,
            email,
            password: hashedPassword,
            role
        });
        
        log(`Usuário '${name}' criado com sucesso com ID: ${newUser.id}`);
        // Retorna um objeto simples do usuário sem a senha, como na versão SQLite
        return { id: newUser.id, name, email, role, createdAt: newUser.createdAt, updatedAt: newUser.updatedAt };
    } catch (err) {
        error("Erro ao criar usuário no PostgreSQL:", err.message);
        throw err;
    }
};

/**
 * Retorna todos os usuários do PostgreSQL.
 * @returns {Promise<Array<object>>} Uma lista de usuários (objetos simples, sem a senha).
 */
export const getAllUsers = async () => {
    try {
        // Usa 'attributes' para excluir o campo 'password' da resposta por segurança.
        const users = await db.User.findAll({
            attributes: ['id', 'name', 'email', 'role', 'createdAt', 'updatedAt'],
            order: [['name', 'ASC']]
        });
        // Mapeia para objetos simples para manter o paradigma de retorno
        return users.map(user => user.get({ plain: true })); 
    } catch (err) {
        error("Erro ao buscar todos os usuários do PostgreSQL:", err.message);
        return [];
    }
};

/**
 * Atualiza os dados de um usuário no PostgreSQL.
 * @param {string} id - O UUID do usuário.
 * @param {object} updateData - { name, email, password, role }
 * @returns {Promise<boolean>} True se atualizado, lança erro se não encontrado ou falhar.
 */
export const updateUser = async (id, updateData) => {
    try {
        const user = await db.User.findByPk(id);
        if (!user) {
            throw new Error("Usuário não encontrado.");
        }

        // Se uma nova senha for fornecida, faz o hash antes de salvar
        if (updateData.password) {
            updateData.password = await bcrypt.hash(updateData.password, SALT_ROUNDS);
        }

        const [affectedRows] = await db.User.update(updateData, { where: { id } }); // Retorna o número de linhas afetadas
        
        if (affectedRows === 0) {
            // Isso só ocorreria se o findByPk tivesse falhado antes do update
            throw new Error("Falha ao atualizar o usuário. Nenhuma linha afetada.");
        }

        log(`Usuário ID ${id} atualizado com sucesso.`);
        return true;
    } catch (err) {
        error(`Erro ao atualizar usuário ID ${id} no PostgreSQL:`, err.message);
        throw err;
    }
};

/**
 * Deleta um usuário do PostgreSQL.
 * @param {string} id - O UUID do usuário.
 * @returns {Promise<boolean>} True se deletado, lança erro se não encontrado ou falhar.
 */
export const deleteUser = async (id) => {
    try {
        const result = await db.User.destroy({ where: { id } }); // Retorna o número de linhas deletadas
        if (result === 0) {
            throw new Error('Nenhum usuário encontrado com este ID.');
        }
        log(`Usuário ID ${id} deletado com sucesso.`);
        return true;
    } catch (err) {
        error(`Erro ao deletar usuário ID ${id} no PostgreSQL:`, err.message);
        throw err;
    }
};