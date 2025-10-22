// ARQUIVO COMPLETO E CORRIGIDO: src/models/criterion.model.js

import { Model, DataTypes } from 'sequelize';
// <-- MUDANÇA: As importações necessárias para os hooks foram restauradas aqui.
import { addOrUpdateVector, deleteVector } from '../services/vector.service.js';
import { createEmbedding } from '../services/embedding.service.js';
import { log, error as logError } from '../utils/logger.service.js';

export default (sequelize) => {
  class Criterion extends Model {}

  Criterion.init({
    id: { 
      type: DataTypes.UUID, 
      defaultValue: DataTypes.UUIDV4, 
      primaryKey: true 
    },
    name: { 
      type: DataTypes.STRING, 
      allowNull: false 
    },
    description: { 
      type: DataTypes.TEXT, 
      allowNull: true 
    },
    weight: { 
      type: DataTypes.INTEGER, 
      allowNull: false, 
      defaultValue: 2, 
      validate: { min: 1, max: 3 } 
    },
    order: { 
      type: DataTypes.INTEGER, 
      defaultValue: 0 
    }
  }, {
    sequelize,
    modelName: 'Criterion',
    tableName: 'criteria',
    timestamps: false,
    // --- HOOKS PARA SINCRONIZAÇÃO COM LANCEDB ---
    hooks: {
      afterSave: async (criterion, options) => {
        // 'afterSave' é executado tanto em 'create' quanto em 'update'.
        try {
          // O texto a ser "embedado" pode ser a descrição ou, se não houver, o nome.
          const textToEmbed = criterion.description || criterion.name;
          if (textToEmbed && textToEmbed.trim() !== '') {
            // A função 'createEmbedding' agora está definida e disponível.
            const embedding = await createEmbedding(textToEmbed);
            if (embedding) {
              await addOrUpdateVector(criterion.id, embedding);
            }
          }
        } catch (err) {
          logError(`HOOK (afterSave): Falha ao sincronizar o critério ${criterion.id} com o LanceDB.`, err);
        }
      },
      afterDestroy: async (criterion, options) => {
        // Após deletar no PostgreSQL, remove do LanceDB.
        try {
          await deleteVector(criterion.id);
        } catch (err) {
          logError(`HOOK (afterDestroy): Falha ao remover o critério ${criterion.id} do LanceDB.`, err);
        }
      }
    }
  });

  return Criterion;
};