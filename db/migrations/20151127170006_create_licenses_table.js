var create_licenses_table = new Migration({
	up: function() {
    this.create_table('licenses', function(t) {
      t.integer('provider_id', { unsigned: true, not_null: true });
      t.integer('content_id', { unsigned: true, not_null: true });
      t.integer('sequence_id', { unsigned: true, not_null: true, default_value: '0' });
      t.binary('license', { not_null: true, limit: 16 });
      t.primary_key(['provider_id', 'content_id', 'sequence_id']);
    });
	},
	down: function() {
    this.drop_table('licenses');
	}
});