import { Model, DataTypes } from 'sequelize';

export default (sequelize) => {
  class Category extends Model {
    static associate(models) {
      // Associação com Scorecard
      this.belongsTo(models.Scorecard, {
        foreignKey: 'scorecardId',
        as: 'scorecard',
      });

      // Associação com Criterion
      this.hasMany(models.Criterion, {
        as: 'criteria',
        foreignKey: 'categoryId',
        onDelete: 'CASCADE',
        hooks: true,
      });
    }
  }

  Category.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true },
    },
    // A coluna que está faltando no seu banco de dados atual
    order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    }
  }, {
    sequelize,
    modelName: 'Category',
    tableName: 'categories',
    timestamps: false,
  });

  return Category;
};