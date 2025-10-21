import { Model, DataTypes } from 'sequelize';

export default (sequelize) => {
  class Category extends Model {
    static associate(models) {
      // Define a associação: uma Categoria "pertence a um" Scorecard.
      this.belongsTo(models.Scorecard, {
        foreignKey: 'scorecardId',
        as: 'scorecard',
      });

      // Define a associação: uma Categoria "tem muitos" Critérios.
      this.hasMany(models.Criterion, {
        as: 'criteria',
        foreignKey: 'categoryId',
        onDelete: 'CASCADE', // Se uma categoria for deletada, seus critérios também serão.
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
      validate: {
        notEmpty: true,
      }
    },
    // Define a ordem em que a categoria deve aparecer na interface.
    order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    }
  }, {
    sequelize,
    modelName: 'Category',
    tableName: 'categories',
    timestamps: false, // Geralmente não precisamos de timestamps para categorias.
  });

  return Category;
};