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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      attendance: {
        Row: {
          break_seconds: number
          break_started_at: string | null
          clock_in: string | null
          clock_out: string | null
          company_id: string
          created_at: string
          employee_id: string
          id: string
          note: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at: string
          work_date: string
        }
        Insert: {
          break_seconds?: number
          break_started_at?: string | null
          clock_in?: string | null
          clock_out?: string | null
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
          work_date?: string
        }
        Update: {
          break_seconds?: number
          break_started_at?: string | null
          clock_in?: string | null
          clock_out?: string | null
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      call_history: {
        Row: {
          call_result: Database["public"]["Enums"]["call_result"]
          called_at: string
          company_id: string
          customer_response:
            | Database["public"]["Enums"]["customer_response"]
            | null
          employee_id: string
          id: string
          lead_id: string
          notes: string | null
          status: Database["public"]["Enums"]["lead_status"]
        }
        Insert: {
          call_result: Database["public"]["Enums"]["call_result"]
          called_at?: string
          company_id: string
          customer_response?:
            | Database["public"]["Enums"]["customer_response"]
            | null
          employee_id: string
          id?: string
          lead_id: string
          notes?: string | null
          status: Database["public"]["Enums"]["lead_status"]
        }
        Update: {
          call_result?: Database["public"]["Enums"]["call_result"]
          called_at?: string
          company_id?: string
          customer_response?:
            | Database["public"]["Enums"]["customer_response"]
            | null
          employee_id?: string
          id?: string
          lead_id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
        }
        Relationships: [
          {
            foreignKeyName: "call_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
          plan: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          plan?: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          plan?: string
          status?: string
        }
        Relationships: []
      }
      follow_ups: {
        Row: {
          company_id: string
          created_at: string
          employee_id: string
          follow_up_date: string
          follow_up_time: string | null
          id: string
          is_done: boolean
          lead_id: string
          note: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          employee_id: string
          follow_up_date: string
          follow_up_time?: string | null
          id?: string
          is_done?: boolean
          lead_id: string
          note?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          employee_id?: string
          follow_up_date?: string
          follow_up_time?: string | null
          id?: string
          is_done?: boolean
          lead_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          company_id: string
          employee_id: string
          id: string
          lead_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          company_id: string
          employee_id: string
          id?: string
          lead_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          company_id?: string
          employee_id?: string
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_imports: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string
          current_batch: number
          duplicate_count: number
          error_count: number
          file_name: string
          folder_date: string
          id: string
          imported_by: string | null
          imported_count: number
          processed_rows: number
          started_at: string
          status: string
          total_batches: number
          total_rows: number
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string
          current_batch?: number
          duplicate_count?: number
          error_count?: number
          file_name: string
          folder_date: string
          id?: string
          imported_by?: string | null
          imported_count?: number
          processed_rows?: number
          started_at?: string
          status?: string
          total_batches?: number
          total_rows?: number
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string
          current_batch?: number
          duplicate_count?: number
          error_count?: number
          file_name?: string
          folder_date?: string
          id?: string
          imported_by?: string | null
          imported_count?: number
          processed_rows?: number
          started_at?: string
          status?: string
          total_batches?: number
          total_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_status_history: {
        Row: {
          changed_at: string
          company_id: string
          employee_id: string | null
          id: string
          lead_id: string
          new_status: Database["public"]["Enums"]["lead_status"]
          old_status: Database["public"]["Enums"]["lead_status"] | null
        }
        Insert: {
          changed_at?: string
          company_id: string
          employee_id?: string | null
          id?: string
          lead_id: string
          new_status: Database["public"]["Enums"]["lead_status"]
          old_status?: Database["public"]["Enums"]["lead_status"] | null
        }
        Update: {
          changed_at?: string
          company_id?: string
          employee_id?: string | null
          id?: string
          lead_id?: string
          new_status?: Database["public"]["Enums"]["lead_status"]
          old_status?: Database["public"]["Enums"]["lead_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_status_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_status_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          alternate_mobile: string | null
          assigned_at: string | null
          assigned_to: string | null
          city: string | null
          company_id: string
          created_at: string
          created_by: string | null
          customer_name: string
          date_of_birth: string | null
          email: string | null
          employer: string | null
          employment_type: string | null
          folder_date: string
          id: string
          import_id: string | null
          import_row: number | null
          last_call_at: string | null
          loan_amount: number
          loan_type: string
          location: string | null
          mobile: string
          monthly_income: number | null
          notes: string | null
          pan: string | null
          pincode: string | null
          source: string | null
          state: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
        }
        Insert: {
          alternate_mobile?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          city?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_name: string
          date_of_birth?: string | null
          email?: string | null
          employer?: string | null
          employment_type?: string | null
          folder_date?: string
          id?: string
          import_id?: string | null
          import_row?: number | null
          last_call_at?: string | null
          loan_amount?: number
          loan_type?: string
          location?: string | null
          mobile: string
          monthly_income?: number | null
          notes?: string | null
          pan?: string | null
          pincode?: string | null
          source?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Update: {
          alternate_mobile?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          city?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_name?: string
          date_of_birth?: string | null
          email?: string | null
          employer?: string | null
          employment_type?: string | null
          folder_date?: string
          id?: string
          import_id?: string | null
          import_row?: number | null
          last_call_at?: string | null
          loan_amount?: number
          loan_type?: string
          location?: string | null
          mobile?: string
          monthly_income?: number | null
          notes?: string | null
          pan?: string | null
          pincode?: string | null
          source?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id: string
          is_active?: boolean
          phone?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      lead_folder_counts: {
        Row: {
          company_id: string | null
          folder_date: string | null
          lead_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "super_admin" | "company_admin" | "agent"
      attendance_status: "Present" | "Late" | "Half Day" | "Absent" | "Leave"
      call_result:
        | "Connected"
        | "No Answer"
        | "Busy"
        | "Switched Off"
        | "Wrong Number"
      customer_response:
        | "Interested"
        | "Not Interested"
        | "Follow-up Required"
        | "Documents Required"
        | "Application Submitted"
        | "Other"
      lead_status:
        | "New"
        | "Assigned"
        | "Contacted"
        | "Interested"
        | "Follow-up"
        | "Documents Pending"
        | "Application Submitted"
        | "Processing"
        | "Approved"
        | "Disbursed"
        | "Not Interested"
        | "Not Eligible"
        | "Wrong Number"
        | "No Response"
        | "Closed"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "company_admin", "agent"],
      attendance_status: ["Present", "Late", "Half Day", "Absent", "Leave"],
      call_result: [
        "Connected",
        "No Answer",
        "Busy",
        "Switched Off",
        "Wrong Number",
      ],
      customer_response: [
        "Interested",
        "Not Interested",
        "Follow-up Required",
        "Documents Required",
        "Application Submitted",
        "Other",
      ],
      lead_status: [
        "New",
        "Assigned",
        "Contacted",
        "Interested",
        "Follow-up",
        "Documents Pending",
        "Application Submitted",
        "Processing",
        "Approved",
        "Disbursed",
        "Not Interested",
        "Not Eligible",
        "Wrong Number",
        "No Response",
        "Closed",
      ],
    },
  },
} as const
