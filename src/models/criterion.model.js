// ARQUIVO COMPLETO E FINAL: src/models/criterion.model.js

import { Model, DataTypes } from 'sequelize';
// <-- MUDANÇA CRÍTICA: As importações de serviços foram REMOVIDAS do topo do arquivo.

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
    hooks: {
      afterSave: async (criterion, options) => {
        // <-- MUDANÇA CRÍTICA: Os serviços são importados AQUI, dentro da função.
        const { addOrUpdateVector } = await import('../services/vector.service.js');
        const { createEmbedding } = await import('../services/embedding.service.js');
        const { error: logError } = await import('../utils/logger.service.js');

        try {
          const textToEmbed = criterion.description || criterion.name;
          if (textToEmbed && textToEmbed.trim() !== '') {
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
        // <-- MUDANÇA CRÍTICA: Os serviços são importados AQUI também.
        const { deleteVector } = await import('../services/vector.service.js');
        const { error: logError } = await import('../utils/logger.service.js');

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