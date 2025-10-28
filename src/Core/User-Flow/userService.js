// ARQUIVO COMPLETO E ATUALIZADO: src/Core/User-Flow/userService.js

import db from '../../models/index.js'; // <-- MUDANÇA: Importa dos models do Sequelize
import bcrypt from 'bcrypt';
import { log, error } from '../../utils/logger.service.js';

const SALT_ROUNDS = 10;

/**
 * Busca um usuário pelo email no PostgreSQL.
 * @param {string} email
 * @returns {Promise<object|null>} O usuário encontrado ou null.
 */
export const findUserByEmail = async (email) => {
    try {
        const user = await db.User.findOne({ where: { email } });
        return user;
    } catch (err) {
        error("Erro ao buscar usuário por email no PostgreSQL:", err.message);
        return null;
    }
};

/**
 * Cria um novo usuário no PostgreSQL.
 * @param {object} userData - { name, email, password, role }
 * @returns {Promise<object>} O novo usuário criado (sem a senha).
 */
export const createUser = async ({ name, email, password, role = 'user' }) => {
    try {
        const existingUser = await findUserByEmail(email);
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
        // Retorna o objeto do usuário sem a senha
        return { id: newUser.id, name, email, role };
    } catch (err) {
        error("Erro ao criar usuário no PostgreSQL:", err.message);
        throw err;
    }
};

/**
 * Retorna todos os usuários do PostgreSQL.
 * @returns {Promise<Array<object>>} Uma lista de usuários.
 */
export const getAllUsers = async () => {
    try {
        // Usa 'attributes' para excluir o campo 'password' da resposta por segurança.
        const users = await db.User.findAll({
            attributes: ['id', 'name', 'email', 'role', 'createdAt', 'updatedAt'],
            order: [['name', 'ASC']]
        });
        return users;
    } catch (err) {
        error("Erro ao buscar todos os usuários do PostgreSQL:", err.message);
        return [];
    }
};

/**
 * Atualiza os dados de um usuário no PostgreSQL.
 * @param {string} id - O UUID do usuário.
 * @param {object} updateData - { name, email, password, role }
 * @returns {Promise<boolean>}
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

        await user.update(updateData);
        
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
 * @returns {Promise<boolean>}
 */
export const deleteUser = async (id) => {
    try {
        const result = await db.User.destroy({ where: { id } });
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