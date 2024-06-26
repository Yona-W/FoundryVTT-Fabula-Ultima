import { OptionalDataField } from './optional-data-field.mjs';

export class OptionalFeatureTypeDataModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const { StringField, SchemaField, BooleanField } = foundry.data.fields;
		return {
			summary: new SchemaField({ value: new StringField() }),
			source: new StringField(),
			isFavored: new SchemaField({ value: new BooleanField() }),
			optionalType: new StringField({
				nullable: false,
				initial: () => Object.keys(CONFIG.FU.optionalFeatureRegistry?.optionals() ?? {})[0],
				choices: () => Object.keys(CONFIG.FU.optionalFeatureRegistry?.optionals() ?? {}),
			}),
			data: new OptionalDataField('optionalType'),
		};
	}

	prepareDerivedData() {
		this.data?.prepareData();
	}

	/**
	 * For default item chat messages to pick up description.
	 * @return {*}
	 */
	get description() {
		return this.data.description;
	}
}
