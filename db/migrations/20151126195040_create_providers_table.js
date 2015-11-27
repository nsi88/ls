var create_providers_table = new Migration({
	up: function() {
    this.create_table('providers', function(t) {
      t.integer('id', { unsigned: true, not_null: true, auto_increment: true });
      t.string('name', { not_null: true });
      t.integer('flags', { unsigned: true, not_null: true, default_value: '0' });
      t.integer('encryption_key_id', { unsigned: true, not_null: true });
      t.primary_key('id');
    });
	},
	down: function() {
    this.drop_table('providers');
	}
});