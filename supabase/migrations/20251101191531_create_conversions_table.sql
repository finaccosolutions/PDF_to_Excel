/*
  # Bank Statement Conversion System

  1. New Tables
    - conversions
      - id (uuid, primary key) - Unique identifier for each conversion
      - user_id (uuid) - Reference to authenticated user
      - original_filename (text) - Name of the uploaded PDF file
      - extracted_data (jsonb) - Parsed transaction data from PDF
      - status (text) - Conversion status (processing, completed, failed)
      - created_at (timestamptz) - Timestamp of conversion creation
      - updated_at (timestamptz) - Last update timestamp
    
    - user_preferences
      - id (uuid, primary key) - Unique identifier
      - user_id (uuid, unique) - Reference to authenticated user
      - column_mappings (jsonb) - Custom column mapping preferences
      - auto_remove_headers (boolean) - Auto-remove bank header/footer data
      - created_at (timestamptz) - Creation timestamp
      - updated_at (timestamptz) - Last update timestamp

  2. Security
    - Enable RLS on both tables
    - Users can only access their own conversion history
    - Users can only manage their own preferences
*/

CREATE TABLE IF NOT EXISTS conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  original_filename text NOT NULL,
  extracted_data jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'processing',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  column_mappings jsonb DEFAULT '{}'::jsonb,
  auto_remove_headers boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversions"
  ON conversions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversions"
  ON conversions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversions"
  ON conversions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversions"
  ON conversions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own preferences"
  ON user_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences"
  ON user_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON user_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow anonymous conversions for public use"
  ON conversions
  FOR ALL
  TO anon
  USING (user_id IS NULL)
  WITH CHECK (user_id IS NULL);