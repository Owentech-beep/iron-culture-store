BEGIN;

CREATE TABLE product_goals (
  slug VARCHAR(40) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  position INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE product_goal_items (
  goal_slug VARCHAR(40) NOT NULL
    REFERENCES product_goals(slug) ON DELETE CASCADE,
  product_id INTEGER NOT NULL
    REFERENCES products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 3),
  PRIMARY KEY (goal_slug, product_id),
  UNIQUE (goal_slug, position)
);

CREATE INDEX product_goal_items_product_idx
  ON product_goal_items(product_id);

INSERT INTO product_goals (slug, name, position)
VALUES
  ('muscle-gain', 'Muscle Gain', 1),
  ('strength', 'Strength', 2),
  ('performance', 'Performance', 3),
  ('recovery', 'Recovery', 4),
  ('fat-loss', 'Fat Loss', 5);

COMMIT;