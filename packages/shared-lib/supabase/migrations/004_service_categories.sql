CREATE TABLE service_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  icon_url    TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE service_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id     UUID REFERENCES service_categories(id),
  name            TEXT NOT NULL,
  description     TEXT,
  base_price      NUMERIC(10,2) NOT NULL,
  estimated_mins  INT DEFAULT 60,
  icon_url        TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
