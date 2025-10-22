import { Model, DataTypes } from 'sequelize';

// Com SQLite, não usamos 'pg-vector'. Os vetores são armazenados como BLOBs (Binary Large Objects).
// Criamos funções helper para converter entre o array de números da IA e o Buffer do banco.

/**
 * Converte um array de números (vetor) em um Buffer para armazenamento no SQLite.
 * @param {number[]} vector O vetor de embedding.
 * @returns {Buffer}
 */
const vectorToBuffer = (vector) => {
  if (!vector) return null;
  const float32Array = new Float32Array(vector);
  return Buffer.from(float32Array.buffer);
};

/**
 * Converte um Buffer do SQLite de volta para um array de números (vetor).
 * @param {Buffer} buffer O buffer lido do banco.
 * @returns {number[]}
 */
const bufferToVector = (buffer) => {
  if (!buffer) return null;
  const float32Array = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / Float32Array.BYTES_PER_ELEMENT);
  return Array.from(float32Array);
};


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
      // Armazenamos o vetor como um BLOB
      type: DataTypes.BLOB('long'),
      allowNull: false,
      // Usamos getters e setters para fazer a conversão automaticamente
      get() {
        const buffer = this.getDataValue('embedding');
        return bufferToVector(buffer);
      },
      set(vector) {
        const buffer = vectorToBuffer(vector);
        this.setDataValue('embedding', buffer);
      }
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