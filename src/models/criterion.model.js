import { Model, DataTypes } from 'sequelize';
import { toSql } from 'pg-vector';

/**
 * Adiciona o tipo de dado 'VECTOR' ao objeto DataTypes do Sequelize.
 * @param {object} dataTypes - O objeto DataTypes importado do Sequelize.
 */
const registerVectorType = (dataTypes) => {
  // Define a nova propriedade VECTOR diretamente no objeto DataTypes
  dataTypes.VECTOR = function VECTOR(length) {
    if (!length) {
      throw new Error('Você deve especificar o comprimento do vetor. Ex: DataTypes.VECTOR(1536)');
    }
    // Retorna uma representação interna que o Sequelize entende
    return {
      type: `VECTOR(${length})`,
      toSql: (value) => toSql(value),
      parse: (value) => value,
    };
  };
};

// Chama a função imediatamente para modificar o objeto DataTypes importado
registerVectorType(DataTypes);


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
      comment: 'Instrução para a IA sobre o que e como avaliar este critério.',
    },
    weight: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2, // 1=Baixo, 2=Médio, 3=Alto
      validate: { min: 1, max: 3 },
      comment: 'Peso do critério para o cálculo da nota ponderada (1-3).',
    },
    embedding: {
      // AGORA DataTypes.VECTOR existe e é uma função
      type: DataTypes.VECTOR(1536), 
      allowNull: false,
      comment: 'Vetor de embedding gerado a partir do nome e descrição do critério.',
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