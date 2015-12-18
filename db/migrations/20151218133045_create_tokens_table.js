var create_tokens_table = new Migration({
	up: function() {
    this.create_table('tokens', function(t) {
      t.char('payload', { limit: 128, not_null: true });
      t.integer('exp', { unsigned: true, not_null: true });
      t.primary_key('payload');
    });
	},
	down: function() {
    this.drop_table('tokens');
	}
});