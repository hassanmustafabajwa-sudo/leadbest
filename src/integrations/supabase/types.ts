export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_user_connections: {
        Row: {
          account_email: string | null
          connection_key_ciphertext: string
          connector_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_email?: string | null
          connection_key_ciphertext: string
          connector_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_email?: string | null
          connection_key_ciphertext?: string
          connector_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          subject: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          name: string
          subject?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      decision_makers: {
        Row: {
          company_name: string
          company_website: string | null
          confidence: number
          created_at: string
          evidence: Json
          full_name: string
          id: string
          imported_lead_id: string | null
          job_title: string | null
          linkedin_url: string | null
          location: string | null
          match_key: string
          professional_email: string | null
          professional_phone: string | null
          source_urls: Json
          target_service: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name: string
          company_website?: string | null
          confidence?: number
          created_at?: string
          evidence?: Json
          full_name: string
          id?: string
          imported_lead_id?: string | null
          job_title?: string | null
          linkedin_url?: string | null
          location?: string | null
          match_key: string
          professional_email?: string | null
          professional_phone?: string | null
          source_urls?: Json
          target_service?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string
          company_website?: string | null
          confidence?: number
          created_at?: string
          evidence?: Json
          full_name?: string
          id?: string
          imported_lead_id?: string | null
          job_title?: string | null
          linkedin_url?: string | null
          location?: string | null
          match_key?: string
          professional_email?: string | null
          professional_phone?: string | null
          source_urls?: Json
          target_service?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_makers_imported_lead_id_fkey"
            columns: ["imported_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          ai_analysis: Json | null
          ai_score: number | null
          city: string | null
          company_name: string
          contact_page_url: string | null
          country: string | null
          created_at: string
          description: string | null
          email: string | null
          enriched_at: string | null
          enrichment_error: string | null
          enrichment_status: string
          first_name: string | null
          id: string
          industry: string | null
          last_name: string | null
          maps_url: string | null
          outreach_status: string
          phone: string | null
          qualification_status: string
          rating: number | null
          recommended_service: string | null
          review_count: number | null
          social_links: Json | null
          source: string
          source_id: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          address?: string | null
          ai_analysis?: Json | null
          ai_score?: number | null
          city?: string | null
          company_name: string
          contact_page_url?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          enriched_at?: string | null
          enrichment_error?: string | null
          enrichment_status?: string
          first_name?: string | null
          id?: string
          industry?: string | null
          last_name?: string | null
          maps_url?: string | null
          outreach_status?: string
          phone?: string | null
          qualification_status?: string
          rating?: number | null
          recommended_service?: string | null
          review_count?: number | null
          social_links?: Json | null
          source?: string
          source_id?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          address?: string | null
          ai_analysis?: Json | null
          ai_score?: number | null
          city?: string | null
          company_name?: string
          contact_page_url?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          enriched_at?: string | null
          enrichment_error?: string | null
          enrichment_status?: string
          first_name?: string | null
          id?: string
          industry?: string | null
          last_name?: string | null
          maps_url?: string | null
          outreach_status?: string
          phone?: string | null
          qualification_status?: string
          rating?: number | null
          recommended_service?: string | null
          review_count?: number | null
          social_links?: Json | null
          source?: string
          source_id?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      linkedin_leads: {
        Row: {
          company_email: string | null
          company_name: string | null
          company_phone: string | null
          company_url: string | null
          confidence: number
          created_at: string
          evidence: Json
          full_name: string
          headline: string | null
          id: string
          imported_lead_id: string | null
          industry: string | null
          job_title: string | null
          linkedin_url: string | null
          location: string | null
          match_key: string
          professional_email: string | null
          professional_phone: string | null
          seniority: string | null
          source_type: string
          source_urls: Json
          target_service: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_email?: string | null
          company_name?: string | null
          company_phone?: string | null
          company_url?: string | null
          confidence?: number
          created_at?: string
          evidence?: Json
          full_name: string
          headline?: string | null
          id?: string
          imported_lead_id?: string | null
          industry?: string | null
          job_title?: string | null
          linkedin_url?: string | null
          location?: string | null
          match_key: string
          professional_email?: string | null
          professional_phone?: string | null
          seniority?: string | null
          source_type?: string
          source_urls?: Json
          target_service?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_email?: string | null
          company_name?: string | null
          company_phone?: string | null
          company_url?: string | null
          confidence?: number
          created_at?: string
          evidence?: Json
          full_name?: string
          headline?: string | null
          id?: string
          imported_lead_id?: string | null
          industry?: string | null
          job_title?: string | null
          linkedin_url?: string | null
          location?: string | null
          match_key?: string
          professional_email?: string | null
          professional_phone?: string | null
          seniority?: string | null
          source_type?: string
          source_urls?: Json
          target_service?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_leads_imported_lead_id_fkey"
            columns: ["imported_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_messages: {
        Row: {
          body: string
          campaign_id: string | null
          created_at: string
          error_message: string | null
          gmail_message_id: string | null
          id: string
          lead_id: string
          personalized_body: string | null
          recipient_email: string | null
          sent_at: string | null
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          body: string
          campaign_id?: string | null
          created_at?: string
          error_message?: string | null
          gmail_message_id?: string | null
          id?: string
          lead_id: string
          personalized_body?: string | null
          recipient_email?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          body?: string
          campaign_id?: string | null
          created_at?: string
          error_message?: string | null
          gmail_message_id?: string | null
          id?: string
          lead_id?: string
          personalized_body?: string | null
          recipient_email?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      search_results: {
        Row: {
          address: string | null
          business_name: string
          category: string | null
          city: string | null
          country: string | null
          created_at: string
          description: string | null
          email: string | null
          id: string
          imported_lead_id: string | null
          maps_url: string | null
          match_key: string
          phone: string | null
          quality_score: number
          rating: number | null
          review_count: number | null
          run_id: string
          social_links: Json
          sources: Json
          updated_at: string
          user_id: string
          website: string | null
          website_evidence: Json
          website_status: string
        }
        Insert: {
          address?: string | null
          business_name: string
          category?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          imported_lead_id?: string | null
          maps_url?: string | null
          match_key: string
          phone?: string | null
          quality_score?: number
          rating?: number | null
          review_count?: number | null
          run_id: string
          social_links?: Json
          sources?: Json
          updated_at?: string
          user_id: string
          website?: string | null
          website_evidence?: Json
          website_status?: string
        }
        Update: {
          address?: string | null
          business_name?: string
          category?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          imported_lead_id?: string | null
          maps_url?: string | null
          match_key?: string
          phone?: string | null
          quality_score?: number
          rating?: number | null
          review_count?: number | null
          run_id?: string
          social_links?: Json
          sources?: Json
          updated_at?: string
          user_id?: string
          website?: string | null
          website_evidence?: Json
          website_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_results_imported_lead_id_fkey"
            columns: ["imported_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "search_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      search_runs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          location: string
          max_leads: number | null
          min_leads: number | null
          niche: string
          result_count: number
          rounds: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          location: string
          max_leads?: number | null
          min_leads?: number | null
          niche: string
          result_count?: number
          rounds?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          location?: string
          max_leads?: number | null
          min_leads?: number | null
          niche?: string
          result_count?: number
          rounds?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          ai_model: string | null
          ai_provider: string
          created_at: string
          lead_source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_model?: string | null
          ai_provider?: string
          created_at?: string
          lead_source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_model?: string | null
          ai_provider?: string
          created_at?: string
          lead_source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
