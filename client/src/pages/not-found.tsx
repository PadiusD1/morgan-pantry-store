import React from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="w-full flex items-center justify-center py-16" data-testid="page-404">
      <Card className="w-full max-w-md mx-4 glass-panel">
        <CardContent className="pt-6 text-center">
          <div className="flex mb-4 gap-2 items-center justify-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-semibold" data-testid="text-404-heading">
              Page not found
            </h1>
          </div>

          <p className="mt-2 text-sm text-muted-foreground" data-testid="text-404-body">
            The page you’re looking for doesn’t exist. Use the navigation or return to the dashboard.
          </p>

          <div className="mt-5 flex justify-center">
            <Button asChild data-testid="button-back-home">
              <Link href="/">Back to Dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
