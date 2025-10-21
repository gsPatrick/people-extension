import { Model, DataTypes } from 'sequelize';
// O model é exportado como uma função que recebe a instância do sequelize.
// Isso permite que o arquivo models/index.js o inicialize e configure as associações.
export default (sequelize) => {
class Scorecard extends Model {
/**
* Helper para definir associações.
* Este método é chamado automaticamente pelo models/index.js.
*/
static associate(models) {
// Define a associação: um Scorecard "tem muitas" Categorias.
this.hasMany(models.Category, {
as: 'categories',
foreignKey: 'scorecardId',
onDelete: 'CASCADE', // Se um scorecard for deletado, suas categorias também serão.
hooks: true, // Garante que hooks (se houver) sejam disparados na exclusão em cascata.
});
}
}
Scorecard.init({
id: {
type: DataTypes.UUID,
defaultValue: DataTypes.UUIDV4,
primaryKey: true,
},
name: {
type: DataTypes.STRING,
allowNull: false,
validate: {
notEmpty: true, // Garante que o nome não seja uma string vazia.
}
},
// Define a origem do scorecard, ex: 'internal', 'inhire'
atsIntegration: {
type: DataTypes.STRING,
allowNull: false,
defaultValue: 'internal',
},
// Guarda o ID original do kit da InHire ou de outro ATS, se aplicável.
externalId: {
type: DataTypes.STRING,
allowNull: true,
unique: true, // Garante que não possamos importar o mesmo kit duas vezes.
}
}, {
sequelize,
modelName: 'Scorecard',
tableName: 'scorecards',
timestamps: true, // createdAt e updatedAt serão gerenciados automaticamente.
});
return Scorecard;
};  