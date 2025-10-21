import { Model, DataTypes } from 'sequelize';
import { toSql } from 'pg-vector';

/**
 * Registra um tipo de dado customizado 'VECTOR' no Sequelize para compatibilidade com pgvector.
 * Esta função é chamada antes de qualquer model que use o tipo VECTOR ser inicializado.
 * @param {Sequelize} sequelize - A instância do Sequelize.
 */
const registerVectorType = (sequelize) => {
  // Hook que roda antes da inicialização dos models
  sequelize.addHook('beforeInit', (config) => {
    // Define um novo tipo de dado chamado 'VECTOR'
    config.DataTypes.VECTOR = function VECTOR(length) {
      if (!length) {
        throw new Error('Você deve especificar o comprimento do vetor. Ex: DataTypes.VECTOR(1536)');
      }
      return {
        type: `VECTOR(${length})`,
        // Função que converte o array de números do JS para o formato de string que o pgvector entende.
        toSql: (value) => toSql(value),
        // A leitura do banco já retorna o formato correto, então não precisamos de um 'parse'.
        parse: (value) => value,
      };
    };
  });
};

export default (sequelize) => {
  // Executa a função de registro para que o Sequelize conheça o tipo 'VECTOR'
  registerVectorType(sequelize);

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
      validate: {
        min: 1,
        max: 3,
      },
      comment: 'Peso do critério para o cálculo da nota ponderada (1-3).',
    },
    embedding: {
      type: DataTypes.VECTOR(1536), // Usa o tipo customizado (dimensão do text-embedding-3-small)
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