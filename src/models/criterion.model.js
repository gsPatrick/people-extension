// ARQUIVO COMPLETO: src/models/criterion.model.js

import { Model, DataTypes } from 'sequelize';

export default (sequelize) => {
  class Criterion extends Model {}

  Criterion.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    weight: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2,
      validate: { min: 1, max: 3 },
    },
    // <-- MUDANÇA: O campo embedding foi removido/comentado por enquanto.
    // embedding: {
    //   type: 'VECTOR(1536)', // Exemplo para pgvector, ou DataTypes.JSONB para LanceDB
    //   allowNull: true, 
    // },
    order: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    }
  }, {
    sequelize,
    modelName: 'Criterion',
    tableName: 'criteria',
    timestamps: false,
  });

  return Criterion;
};