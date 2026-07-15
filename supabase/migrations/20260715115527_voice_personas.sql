-- Voice Personas Table
CREATE TABLE public.voice_personas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    external_voice_id text NOT NULL,
    name text NOT NULL,
    role text,
    gender text,
    preview_url text,
    nationality text,
    provider text DEFAULT '11labs',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.voice_personas ENABLE ROW LEVEL SECURITY;

-- Read access for all authenticated users
CREATE POLICY "Enable read access for all authenticated users"
ON public.voice_personas FOR SELECT
TO authenticated
USING (true);

-- Insert/Update/Delete access for superadmins
CREATE POLICY "Enable write access for superadmins only"
ON public.voice_personas FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.is_super_admin = true
    )
);

-- Insert initial data
INSERT INTO public.voice_personas (external_voice_id, name, role, gender, preview_url, nationality, provider) VALUES
('JBFqnCBsd6RMkjVDRZzb', 'British Male - Polished & Professional', 'Corporate, executive presentations', 'Male', '/audio/george.mp3', 'British', '11labs'),
('Xb7hH8MSALEjdAeoWhZl', 'British Female - Crisp & Authoritative', 'Instructions, technical support', 'Female', '/audio/alice.mp3', 'British', '11labs'),
('pFZP5JQG7iQjIQuC4Bku', 'British Female - Warm & Expressive', 'Storytelling, educational tools', 'Female', '/audio/lily.mp3', 'British', '11labs'),
('XrExE9yKIg1WjnnRuVNn', 'British Female - Soft & Calming', 'Meditation, luxury branding', 'Female', '/audio/matilda.mp3', 'British', '11labs'),
('N2lVS1w4EtoT3dr4eOWO', 'British Male - Deep & Confident', 'Luxury retail, premium brand navigation', 'Male', '/audio/callum.mp3', 'British', '11labs'),
('SOYHLrjzK2X1ezoPC6cr', 'British Male - Energetic & Youthful', 'Gaming, entertainment, casual chat', 'Male', '/audio/harry.mp3', 'British', '11labs'),
('CYw3kZ02Hs0563khs1Fj', 'British Male - Casual & Relatable', 'E-commerce, lifestyle assistant', 'Male', '/audio/dave.mp3', 'British', '11labs'),
('zrHiDhphv9ZnVBTiNxbM', 'British Female - Vibrant & Bubbly', 'Pop culture, youth-focused apps', 'Female', '/audio/mimi.mp3', 'British', '11labs'),
('IKne3meq5aSn9XLyUdCD', 'British/Aussie Male - Friendly & Natural', 'Conversational assistant', 'Male', '/audio/charlie.mp3', 'British/Aussie', '11labs'),
('21m00Tcm4TlvDq8ikWAM', 'American Female - Clear & Direct', 'Customer service, daily logging', 'Female', '/audio/rachel.mp3', 'American', '11labs'),
('29vD33N1CtxCmqQRPOHJ', 'American Male - Sharp & Precise', 'Analytics, B2B software', 'Male', '/audio/drew.mp3', 'American', '11labs'),
('2EiwWnXFnvU5JabPnv8n', 'American Male - Urban & Smooth', 'Lifestyle, food apps', 'Male', '/audio/clyde.mp3', 'American', '11labs'),
('MF3mGyEYCl7XYWbV9V6O', 'American Female - Gentle & Empathetic', 'Mental health, support', 'Female', '/audio/elli.mp3', 'American', '11labs'),
('ErXwobaYiN019PkySvjV', 'American Male - Charismatic & Bold', 'Presentations, sales', 'Male', '/audio/antoni.mp3', 'American', '11labs'),
('D38z5RcWu1voky8WS1ja', 'Irish Male - Witty & Clever', 'Smart assistants with an edge', 'Male', '/audio/fin.mp3', 'Irish', '11labs');
