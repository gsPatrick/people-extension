import { Model, DataTypes } from 'sequelize';

// Não precisamos mais de 'pg-vector' ou da função de registro.

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
    embedding: {
      // MUDANÇA PRINCIPAL: Armazenamos o vetor como um JSON.
      // JSONB é otimizado para busca e armazenamento de JSON em PostgreSQL.
      type: DataTypes.JSONB,
      allowNull: false,
      comment: 'Vetor de embedding armazenado como um array JSON.',
    },
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